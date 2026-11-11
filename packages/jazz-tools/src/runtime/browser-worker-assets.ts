import { METRO_SETUP_ERROR } from "./metro-setup-error.js";

/**
 * Where a bundler put Jazz's browser worker and WASM.
 *
 * Bundlers that follow `new URL(..., import.meta.url)` (Vite, webpack,
 * Turbopack) use this module. Two others take its place by path, so all three
 * export the same names:
 * - `browser-worker-assets.native.ts` on React Native, through the
 *   `react-native` field of package.json. Expo's Metro turns every
 *   `new SharedWorker(new URL(...))` it bundles into a worker chunk, so the
 *   literal below must stay out of the iOS and Android graphs.
 * - `browser-worker-assets.metro.ts` on Expo web, through `withJazzMetro` from
 *   `jazz-tools/metro`.
 */
export function browserRuntimeModuleUrl(): string {
  return import.meta.url;
}
export function bundledBrowserWorkerUrl(): string {
  return new URL("../worker/jazz-broker-worker.js", import.meta.url).href;
}

/**
 * URL of the WASM binary, for a bundler that cannot follow wasm-bindgen's own
 * `new URL("jazz_wasm_bg.wasm", import.meta.url)`. These bundlers can, so
 * wasm-bindgen keeps resolving the binary itself.
 */
export function bundledWasmUrl(): string | null {
  return null;
}

/**
 * The only place the bundled broker SharedWorker is constructed.
 *
 * The foreground lease and the runtime connection must attach to the same
 * SharedWorker realm, and a realm is keyed by script URL plus name. webpack 5
 * emits a separate worker chunk (with a distinct URL) for every
 * `new SharedWorker(new URL(..., import.meta.url))` expression it finds, so
 * two such expressions put the lease and the runtime in different realms and
 * the runtime never starts. Keep exactly one statically analyzable
 * construction here so every bundler emits a single broker worker chunk.
 *
 * `versionedUrl` is the bundled worker's URL with a `runtimeSources.wasmVersion`
 * added, which no literal can carry.
 */
export function createBundledBrokerWorker(name: string, versionedUrl?: string): SharedWorker {
  if (versionedUrl) return new SharedWorker(versionedUrl, { type: "module", name });
  const worker = new SharedWorker(new URL("../worker/jazz-broker-worker.js", import.meta.url), {
    type: "module",
    name,
  });
  // Expo's Metro rewrites the expression above into a dedicated Worker, which
  // has no port to attach a lease or a runtime to.
  if (!("port" in worker)) {
    (worker as { terminate?: () => void }).terminate?.();
    throw new Error(METRO_SETUP_ERROR);
  }
  return worker;
}
