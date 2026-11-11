/** Keep browser asset literals visible to bundlers, outside native imports. */
export function browserRuntimeModuleUrl(): string {
  return import.meta.url;
}
export function bundledBrowserWorkerUrl(): string {
  return new URL("../worker/jazz-broker-worker.js", import.meta.url).href;
}

/** Both the foreground lease and the runtime use this one bundled worker entry. */
export function createBundledBrowserWorker(name: string): SharedWorker {
  return new SharedWorker(new URL("../worker/jazz-broker-worker.js", import.meta.url), {
    type: "module",
    name,
  });
}
