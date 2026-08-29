// Main-thread client for the MuPDF extraction worker
// (worker/mupdfWorkerEntry.ts). Adapted from beaver-zotero's
// MuPDFWorkerClient.ts (AGPL-3.0) but drastically simplified: this project
// only ever needs one PDF extraction in flight, so there's a single worker
// and a plain id-keyed request/response map -- no pooling, leasing, or
// retry queue.
import { config } from "../../../package.json";
import type { ExtractedPage } from "./worker/mupdfWorkerEntry";

interface WorkerResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

class MupdfWorkerClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: Error) => void }
  >();

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const win = Zotero.getMainWindow();
    const WorkerCtor = (win as any).Worker as typeof Worker;
    if (!WorkerCtor) {
      throw new Error("Worker constructor not available on the main window.");
    }
    const url = `chrome://${config.addonRef}/content/scripts/mupdf-worker.js`;
    const worker = new WorkerCtor(url, { type: "module" });
    worker.onmessage = (ev: any) => {
      const { id, ok, result, error } = ev.data as WorkerResponse;
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (ok) pending.resolve(result);
      else pending.reject(new Error(error ?? "MuPDF worker op failed"));
    };
    worker.onerror = (ev: any) => {
      const err = new Error(
        `MuPDF worker error: ${ev?.message ?? "unknown error"}`,
      );
      for (const [, p] of this.pending) p.reject(err);
      this.pending.clear();
    };
    this.worker = worker;
    return worker;
  }

  private request<T>(
    op: "getPageCount" | "extractPage",
    pdfData: ArrayBuffer,
    pageIndex?: number,
  ): Promise<T> {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      // Not transferring pdfData -- a caller may extract multiple pages
      // from the same buffer, and transferring would detach it after the
      // first call.
      worker.postMessage({
        id,
        op,
        addonRef: config.addonRef,
        pdfData,
        pageIndex,
      });
    });
  }

  getPageCount(pdfData: ArrayBuffer): Promise<number> {
    return this.request<number>("getPageCount", pdfData);
  }

  extractPage(pdfData: ArrayBuffer, pageIndex: number): Promise<ExtractedPage> {
    return this.request<ExtractedPage>("extractPage", pdfData, pageIndex);
  }

  /** For tests / explicit cleanup -- lets a fresh worker spawn next call. */
  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const [, p] of this.pending) p.reject(new Error("Worker terminated"));
    this.pending.clear();
  }
}

export const mupdfWorkerClient = new MupdfWorkerClient();
