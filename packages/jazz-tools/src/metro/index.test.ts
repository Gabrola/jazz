import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { withJazzMetro } from "jazz-tools/metro";

const require = createRequire(import.meta.url);
const browserDefaults = fileURLToPath(
  new URL("../../dist/runtime/browser-runtime-sources.js", import.meta.url),
);
const otherModule = fileURLToPath(new URL("../../dist/runtime/context.js", import.meta.url));

type Graph = {
  transformOptions: { platform: string };
  dependencies: Map<string, unknown>;
};
type SerializerOptions = { serializerOptions?: { output?: string } };
type Middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => void;

function fixture() {
  const resolveRequest = vi.fn((_context: unknown, name: string, _platform: string) => ({
    type: "sourceFile",
    filePath: name === "./browser-runtime-sources.js" ? browserDefaults : otherModule,
  }));
  const originalAssets = [{ name: "existing" }];
  const customSerializer = vi.fn(
    async (_entry: string, _preModules: unknown, _graph: Graph, _options: SerializerOptions) => ({
      artifacts: [],
      assets: originalAssets,
    }),
  );
  const enhanceMiddleware = vi.fn(
    (middleware: Middleware, _server: unknown): Middleware =>
      (request, response, next) => {
        response.setHeader("X-Existing-Middleware", "1");
        middleware(request, response, next);
      },
  );
  const config = {
    resolver: { resolveRequest },
    serializer: { customSerializer },
    server: { enhanceMiddleware },
  };
  withJazzMetro(config);
  const metroDefaultsFile = config.resolver.resolveRequest(
    {},
    "./browser-runtime-sources.js",
    "web",
  ).filePath;
  return { config, resolveRequest, originalAssets, metroDefaultsFile };
}

describe("withJazzMetro", () => {
  it("resolves the package-owned defaults on web and preserves other resolutions", () => {
    const { config, resolveRequest, metroDefaultsFile } = fixture();
    expect(metroDefaultsFile).toMatch(/jazz-metro-runtime-sources\.js$/);
    expect(config.resolver.resolveRequest({}, "./browser-runtime-sources.js", "ios").filePath).toBe(
      browserDefaults,
    );
    expect(config.resolver.resolveRequest({}, "./other.js", "web").filePath).toBe(otherModule);
    expect(resolveRequest).toHaveBeenCalledTimes(3);
  });

  it("adds the matching assets once to static web exports that use Jazz's defaults", async () => {
    const { config, originalAssets, metroDefaultsFile } = fixture();
    withJazzMetro(config);
    const options = { serializerOptions: { output: "static" } };
    const dependencies = new Map([[metroDefaultsFile, {}]]);
    const exported = await config.serializer.customSerializer(
      "index.js",
      [],
      { transformOptions: { platform: "web" }, dependencies },
      options,
    );
    const { defaultBrowserRuntimeSources, metroAssetHashes } = require(metroDefaultsFile);
    const { baseUrl, wasmVersion } = defaultBrowserRuntimeSources;
    const wasmHash = createHash("sha256")
      .update(await readFile(new URL("../../dist/worker/jazz_wasm_bg.wasm", import.meta.url)))
      .digest("hex");
    const workerHash = createHash("sha256")
      .update(await readFile(new URL("../../dist/worker/jazz-broker-worker.js", import.meta.url)))
      .digest("hex");
    expect(metroAssetHashes).toEqual({
      "jazz_wasm_bg.wasm": wasmHash,
      "jazz-broker-worker.js": workerHash,
    });
    expect(wasmVersion).toBe(
      createHash("sha256").update(`${workerHash}:${wasmHash}`).digest("hex"),
    );
    expect(exported.assets).toEqual([
      ...originalAssets,
      expect.objectContaining({
        name: "jazz_wasm_bg",
        type: "wasm",
        httpServerLocation: baseUrl,
        hash: wasmHash,
      }),
      expect.objectContaining({
        name: "jazz-broker-worker",
        type: "js",
        httpServerLocation: `${baseUrl}worker/`,
        hash: workerHash,
      }),
    ]);
    expect(originalAssets).toHaveLength(1);
    for (const graph of [
      { transformOptions: { platform: "android" }, dependencies },
      { transformOptions: { platform: "web" }, dependencies: new Map() },
    ]) {
      const result = await config.serializer.customSerializer("index.js", [], graph, options);
      expect(result.assets).toBe(originalAssets);
    }
  });

  it("serves versioned runtime assets and preserves the application's middleware", async () => {
    const { config, metroDefaultsFile } = fixture();
    const { baseUrl, wasmVersion } = require(metroDefaultsFile).defaultBrowserRuntimeSources;
    const handler = config.server.enhanceMiddleware((_request, response) => {
      response.statusCode = 404;
      response.end();
    }, {});
    const server = createServer((request, response) => handler(request, response, () => {}));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const wasm = await fetch(
        `${origin}${baseUrl}jazz_wasm_bg.wasm?jazz-runtime-version=${wasmVersion}`,
        {
          method: "HEAD",
        },
      );
      expect(wasm.status).toBe(200);
      expect(wasm.headers.get("content-type")).toBe("application/wasm");
      const worker = await fetch(`${origin}${baseUrl}worker/jazz-broker-worker.js`);
      expect(worker.status).toBe(200);
      expect(worker.headers.get("content-type")).toMatch(/^text\/javascript/);
      expect(await worker.text()).toContain("onconnect");
      const unrelated = await fetch(`${origin}/unrelated`);
      expect(unrelated.status).toBe(404);
      expect(unrelated.headers.get("x-existing-middleware")).toBe("1");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
