import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as standard from "./browser-worker-assets.js";
import * as metro from "./browser-worker-assets.metro.js";
import * as native from "./browser-worker-assets.native.js";

const srcDir = fileURLToPath(new URL("..", import.meta.url));
const packageJson = JSON.parse(readFileSync(join(srcDir, "../package.json"), "utf8")) as {
  "react-native": Record<string, string>;
};

/** Source without comments, which describe the worker expression without being one. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser worker asset modules", () => {
  it("export the same names for every bundler", () => {
    const names = Object.keys(standard).sort();
    expect(Object.keys(metro).sort()).toEqual(names);
    expect(Object.keys(native).sort()).toEqual(names);
  });

  it("keep the worker a bundler builds out of React Native bundles", () => {
    // Expo's Metro bundles a worker chunk for `new SharedWorker(new URL(...))`
    // on every platform whose graph holds it. The one module with that
    // expression (pinned in browser-shared-worker-connection.test.ts) is
    // replaced on React Native by one that names no worker or binary.
    expect(packageJson["react-native"]).toMatchObject({
      "./dist/runtime/browser-worker-assets.js": "./dist/runtime/browser-worker-assets.native.js",
    });
    const nativeSource = code(join(srcDir, "runtime/browser-worker-assets.native.ts"));
    expect(nativeSource).not.toMatch(/Worker\(|\.wasm|jazz-broker-worker|require\(|import\(/);
  });

  it("refuse browser assets on React Native", () => {
    for (const refuse of Object.values(native)) {
      expect(() => (refuse as () => unknown)()).toThrow("unavailable on React Native");
    }
  });

  it("refuse a bundler that starts the broker as a dedicated worker", () => {
    // What Expo's Metro makes of the SharedWorker expression without withJazzMetro.
    const terminate = vi.fn();
    vi.stubGlobal(
      "SharedWorker",
      class {
        terminate = terminate;
      },
    );

    expect(() => standard.createBundledBrokerWorker("jazz-runtime:test")).toThrow(
      "wrap your Metro config in withJazzMetro from jazz-tools/metro",
    );
    expect(terminate).toHaveBeenCalledOnce();
  });

  it("start the bundled broker as a module SharedWorker, at a versioned URL when given one", () => {
    const constructed: unknown[][] = [];
    vi.stubGlobal(
      "SharedWorker",
      class {
        port = {};
        constructor(...args: unknown[]) {
          constructed.push(args);
        }
      },
    );

    standard.createBundledBrokerWorker("jazz-runtime:a");
    standard.createBundledBrokerWorker("jazz-runtime:b", "https://app.test/worker.js?v=1");

    expect(constructed[0]![0]).toBeInstanceOf(URL);
    expect(String(constructed[0]![0])).toMatch(/\/worker\/jazz-broker-worker\.js$/);
    expect(constructed[0]![1]).toEqual({ type: "module", name: "jazz-runtime:a" });
    expect(constructed[1]).toEqual([
      "https://app.test/worker.js?v=1",
      { type: "module", name: "jazz-runtime:b" },
    ]);
  });
});
