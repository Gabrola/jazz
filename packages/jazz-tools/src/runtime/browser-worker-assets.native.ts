/**
 * React Native takes this module in place of `browser-worker-assets.ts` (the
 * `react-native` field of package.json), which keeps the browser worker and
 * its WASM out of iOS and Android bundles. See that module for the exports.
 */
function unsupported(): never {
  throw new Error("Browser worker assets are unavailable on React Native");
}
export const browserRuntimeModuleUrl: () => string = unsupported;
export const bundledBrowserWorkerUrl: () => string = unsupported;
export const bundledWasmUrl: () => string | null = unsupported;
export const createBundledBrokerWorker: (name: string, versionedUrl?: string) => SharedWorker =
  unsupported;
