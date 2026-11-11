// Expo compiles `import.meta` to `globalThis.__ExpoImportMetaRegistry`, which it
// installs on pages but not in worker chunks. The shipped worker reads
// `import.meta.url`; in a single-file worker that is the worker's own URL.
const scope = globalThis as { __ExpoImportMetaRegistry?: { readonly url: string } };
scope.__ExpoImportMetaRegistry ??= {
  get url() {
    return self.location.href;
  },
};
