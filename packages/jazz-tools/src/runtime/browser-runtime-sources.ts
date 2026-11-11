import type { RuntimeSourcesConfig } from "./context.js";

/** Bundler integrations may resolve this module to package-owned asset URLs. */
export const defaultBrowserRuntimeSources: RuntimeSourcesConfig | undefined = undefined;
