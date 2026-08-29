// Adapted from beaver-zotero's src/beaver-extract/worker/wasmInit.ts
// (AGPL-3.0, see addon/content/lib/mupdf-LICENSE). Simplified: this
// project has one worker and one fixed addonRef, so the URLs are computed
// directly instead of beaver's configure-message handshake (which exists
// there to support multiple environments/worktrees).
//
// Keeping the WASM factory URL dynamic at bundle time matters:
//   1. `await import(factoryUrl)` is a dynamic import whose specifier isn't
//      a string literal at the call site, so esbuild leaves it alone.
//   2. `external: ["chrome://*"]` in zotero-plugin.config.ts is the
//      belt-and-braces backup for any future static `import "chrome://..."`.
//
// Workers don't have ChromeUtils/NetUtil and `fetch('chrome://...')` is
// unreliable in worker scope, so XHR (wasmHelpers.ts) is the only reliable
// path for the WASM binary itself; the factory `.mjs` is small enough that
// a dynamic import is fine.

import { loadWasmBinaryXHR } from "./wasmHelpers";
import {
  makeMupdfBridge,
  type LibMuPdf,
  type MupdfBridge,
} from "./mupdfBridge";

// MuPDF font-loading callback (must exist before WASM init runs).
declare const globalThis: {
  $libmupdf_load_font_file?: (name: string) => null;
};
if (typeof globalThis.$libmupdf_load_font_file !== "function") {
  globalThis.$libmupdf_load_font_file = function (_name: string) {
    return null;
  };
}

let _bridgePromise: Promise<MupdfBridge> | null = null;

export function ensureBridge(addonRef: string): Promise<MupdfBridge> {
  if (_bridgePromise) return _bridgePromise;

  _bridgePromise = (async () => {
    const factoryUrl = `chrome://${addonRef}/content/lib/mupdf-wasm.mjs`;
    const binaryUrl = `chrome://${addonRef}/content/lib/mupdf-wasm.wasm`;

    const wasmBinary = await loadWasmBinaryXHR(binaryUrl);
    const wasmConfig = {
      wasmBinary,
      locateFile: (path: string) =>
        path && path.endsWith(".wasm") ? binaryUrl : path,
    };

    const mod: { default: (config: unknown) => Promise<LibMuPdf> } =
      await import(factoryUrl);
    const libmupdf = await mod.default(wasmConfig);
    libmupdf._wasm_init_context();
    return makeMupdfBridge(libmupdf);
  })();

  return _bridgePromise.catch((e) => {
    _bridgePromise = null;
    throw e;
  });
}
