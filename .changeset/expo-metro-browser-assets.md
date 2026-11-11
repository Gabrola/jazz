---
"jazz-tools": patch
---

Expo: two fixes for apps bundled with Metro.

- The local-first web client now runs on Expo web. Wrap your Metro config in `withJazzMetro` from the new `jazz-tools/metro` entry (`module.exports = withJazzMetro(getDefaultConfig(__dirname))`): Metro then serves Jazz's Wasm and shared worker in development and writes them to `expo export --platform web`. Before, the browser requested `/_expo/static/js/web/jazz_wasm_bg.wasm`, got a 404 and failed with a WebAssembly compile error. Without the helper the client now fails with an error that names it.
- iOS and Android exports no longer contain the browser worker (an extra `jazz-broker-worker-*.hbc` of about 1 MB that the native engine never used). This needs no Metro change.
