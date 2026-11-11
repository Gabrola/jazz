import { createReadStream, realpathSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { basename, join } from "node:path";
import { pipeline } from "node:stream";
import { fileURLToPath } from "node:url";

type Resolution = { type: "sourceFile"; filePath: string } | { type: "assetFiles" | "empty" };
type ResolveRequest = (
  context: { resolveRequest: ResolveRequest },
  moduleName: string,
  platform: string | null,
) => Resolution;
type Middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => unknown;
type Serialize = (
  entry: string,
  preModules: unknown,
  graph: {
    transformOptions: { platform?: string | null };
    dependencies: ReadonlyMap<string, unknown>;
  },
  options: { serializerOptions?: { output?: string } },
) => unknown;

// The public generic preserves the application's Metro config type. This shape
// describes only the Expo hooks the integration uses.
type MetroConfig = { resolver: object; serializer: object; server: object };
type ExpoMetroHooks = {
  resolver: { resolveRequest?: ResolveRequest };
  serializer: { customSerializer?: Serialize };
  server: { enhanceMiddleware?: (middleware: Middleware, server: unknown) => Middleware };
};
type PackagedMetroAssets = {
  defaultBrowserRuntimeSources: { baseUrl: string; wasmVersion: string };
  metroAssetHashes: Record<"jazz_wasm_bg.wasm" | "jazz-broker-worker.js", string>;
};

const require = createRequire(import.meta.url);
const configured = new WeakSet<MetroConfig>();

/** Add Jazz's local-first browser assets to Expo Metro's development and export pipelines. */
export function withJazzMetro<Config extends MetroConfig>(config: Config): Config {
  if (configured.has(config)) return config;
  const metro = config as Config & ExpoMetroHooks;
  const serialize = metro.serializer.customSerializer;
  if (typeof serialize !== "function") {
    throw new Error("withJazzMetro expects a config from expo/metro-config with a serializer");
  }

  const defaultSourcesFile = realpathSync(
    fileURLToPath(new URL("../runtime/browser-runtime-sources.js", import.meta.url)),
  );
  const workerDirectory = fileURLToPath(new URL("../worker/", import.meta.url));
  const metroSourcesFile = realpathSync(join(workerDirectory, "jazz-metro-runtime-sources.js"));
  const { defaultBrowserRuntimeSources, metroAssetHashes } = require(
    metroSourcesFile,
  ) as PackagedMetroAssets;
  const { baseUrl } = defaultBrowserRuntimeSources;
  const assets = [
    {
      name: "jazz_wasm_bg",
      type: "wasm",
      directory: baseUrl,
      contentType: "application/wasm",
      hash: metroAssetHashes["jazz_wasm_bg.wasm"],
    },
    {
      name: "jazz-broker-worker",
      type: "js",
      directory: `${baseUrl}worker/`,
      contentType: "text/javascript; charset=utf-8",
      hash: metroAssetHashes["jazz-broker-worker.js"],
    },
  ].map((asset) => {
    const filename = `${asset.name}.${asset.type}`;
    const file = join(workerDirectory, filename);
    return {
      ...asset,
      url: asset.directory + filename,
      file,
      size: statSync(file).size,
    };
  });
  const assetsByUrl = new Map(assets.map((asset) => [asset.url, asset]));
  const exportAssets = assets.map(({ name, type, directory, file, hash }) => ({
    __packager_asset: true,
    name,
    type,
    scales: [1],
    files: [file],
    fileSystemLocation: workerDirectory,
    httpServerLocation: directory,
    hash,
    fileHashes: [hash],
  }));

  const resolveRequest = metro.resolver.resolveRequest;
  metro.resolver.resolveRequest = function (context, moduleName, platform) {
    const result = resolveRequest
      ? resolveRequest.call(this, context, moduleName, platform)
      : context.resolveRequest(context, moduleName, platform);
    if (
      platform === "web" &&
      result.type === "sourceFile" &&
      basename(result.filePath) === "browser-runtime-sources.js" &&
      realpathSync(result.filePath) === defaultSourcesFile
    ) {
      return { type: "sourceFile", filePath: metroSourcesFile };
    }
    return result;
  };

  // Expo reads these asset records when it writes the static web export.
  metro.serializer.customSerializer = Object.assign(function (
    this: unknown,
    ...args: Parameters<Serialize>
  ) {
    const [, , graph, options] = args;
    const result = serialize.apply(this, args);
    if (
      graph.transformOptions.platform !== "web" ||
      options.serializerOptions?.output !== "static"
    ) {
      return result;
    }
    return Promise.resolve(result).then((output) => {
      if (!graph.dependencies.has(metroSourcesFile)) return output;
      if (
        typeof output !== "object" ||
        output === null ||
        !("assets" in output) ||
        !Array.isArray(output.assets)
      ) {
        throw new Error("withJazzMetro could not add assets to the Expo web export");
      }
      return { ...output, assets: [...output.assets, ...exportAssets] };
    });
  }, serialize);

  const enhanceMiddleware = metro.server.enhanceMiddleware;
  metro.server.enhanceMiddleware = function (middleware, server) {
    const serve = enhanceMiddleware ? enhanceMiddleware.call(this, middleware, server) : middleware;
    return (request, response, next) => {
      const asset = assetsByUrl.get(request.url?.split("?", 1)[0] ?? "");
      if (!asset || (request.method !== "GET" && request.method !== "HEAD")) {
        return serve(request, response, next);
      }
      response.setHeader("Content-Type", asset.contentType);
      response.setHeader("Content-Length", asset.size);
      response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      if (request.method === "HEAD") {
        response.end();
      } else {
        pipeline(createReadStream(asset.file), response, () => {});
      }
    };
  };

  configured.add(config);
  return config;
}
