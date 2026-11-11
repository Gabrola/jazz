import { DefaultRuntimeSource } from "./default-runtime-source.js";
import { defaultBrowserRuntimeSources } from "./browser-runtime-sources.js";
import type { Db } from "./db.js";
import { createAccountDbWithRuntimeSource, type AccountDbConfig } from "../accounts/context.js";

/** Create a browser/Node database backed by the WASM runtime. */
export async function createDb(config: AccountDbConfig): Promise<Db> {
  if (
    config.runtimeSources === undefined &&
    typeof location !== "undefined" &&
    defaultBrowserRuntimeSources
  ) {
    config = { ...config, runtimeSources: defaultBrowserRuntimeSources };
  }
  return await createAccountDbWithRuntimeSource(config, new DefaultRuntimeSource());
}
