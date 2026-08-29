// MuPDF extraction worker entry point (esbuild entry, see
// zotero-plugin.config.ts). Spawned by src/modules/pdf/mupdfWorkerClient.ts
// via `new Worker("chrome://<addonRef>/content/scripts/mupdf-worker.js")`.
//
// Single-worker, single-op-at-a-time request/response protocol -- this
// project never needs more than one PDF extraction in flight, so there's
// no pooling/leasing/retry machinery here (unlike beaver-zotero's, which
// this is adapted from; see mupdfBridge.ts's header).

import { ensureBridge } from "./wasmInit";
import type { MupdfPageGeometry, QuadTuple } from "./mupdfBridge";

export interface ExtractedLine {
  bbox: [number, number, number, number];
  chars: { c: string; quad: QuadTuple }[];
}

export interface ExtractedPage {
  geometry: MupdfPageGeometry;
  lines: ExtractedLine[];
}

interface WorkerRequest {
  id: number;
  op: "getPageCount" | "extractPage";
  addonRef: string;
  pdfData: ArrayBuffer;
  pageIndex?: number;
}

type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

async function handleGetPageCount(
  addonRef: string,
  pdfData: ArrayBuffer,
): Promise<number> {
  const bridge = await ensureBridge(addonRef);
  const doc = bridge.openDocument(pdfData);
  try {
    return doc.countPages();
  } finally {
    doc.destroy();
  }
}

async function handleExtractPage(
  addonRef: string,
  pdfData: ArrayBuffer,
  pageIndex: number,
): Promise<ExtractedPage> {
  const bridge = await ensureBridge(addonRef);
  const doc = bridge.openDocument(pdfData);
  try {
    const page = doc.loadPage(pageIndex);
    try {
      const geometry = page.getGeometry();
      const lines: ExtractedLine[] = [];
      let currentLine: ExtractedLine | null = null;
      page.walkText({
        beginLine: (bbox) => {
          currentLine = { bbox, chars: [] };
        },
        onChar: (c, quad) => {
          currentLine?.chars.push({ c, quad });
        },
        endLine: () => {
          if (currentLine && currentLine.chars.length > 0)
            lines.push(currentLine);
          currentLine = null;
        },
      });
      return { geometry, lines };
    } finally {
      page.destroy();
    }
  } finally {
    doc.destroy();
  }
}

const ctx = (globalThis as any).self as {
  onmessage: ((ev: { data: WorkerRequest }) => void) | null;
  postMessage: (msg: WorkerResponse) => void;
};

ctx.onmessage = async (ev: { data: WorkerRequest }) => {
  const { id, op, addonRef, pdfData, pageIndex } = ev.data;
  try {
    let result: unknown;
    if (op === "getPageCount") {
      result = await handleGetPageCount(addonRef, pdfData);
    } else if (op === "extractPage") {
      result = await handleExtractPage(addonRef, pdfData, pageIndex ?? 0);
    } else {
      throw new Error(`Unknown op: ${String(op)}`);
    }
    ctx.postMessage({ id, ok: true, result });
  } catch (e: any) {
    ctx.postMessage({ id, ok: false, error: e?.message ?? String(e) });
  }
};
