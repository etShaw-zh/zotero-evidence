// Trimmed port of beaver-zotero's src/beaver-extract/worker/mupdfApi.ts
// (AGPL-3.0, see addon/content/lib/mupdf-LICENSE). Keeps only what this
// project needs -- open a PDF from bytes, load a page, read its geometry,
// and walk its structured text for per-character positions. Dropped:
// rendering (Pixmap), search, graphics collection, font metadata, OCR
// glyph-recovery retries, image blocks. None of that is needed to locate a
// quoted passage and compute the rects for a highlight annotation.

export type RectTuple = [number, number, number, number];
export type QuadTuple = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

// The subset of the emscripten module's exports/runtime helpers this
// bridge calls. Matches the actual export names baked into
// addon/content/lib/mupdf-wasm.wasm (confirmed against mupdf-wasm.mjs).
export interface LibMuPdf {
  HEAPF32: Float32Array;
  HEAPU8: Uint8Array;
  UTF8ToString(ptr: number): string;
  stringToUTF8(str: string, ptr: number, maxBytes: number): void;
  lengthBytesUTF8(str: string): number;
  _wasm_init_context(): void;
  _wasm_malloc(size: number): number;
  _wasm_free(ptr: number): void;
  _wasm_new_buffer_from_data(ptr: number, len: number): number;
  _wasm_drop_buffer(ptr: number): void;
  _wasm_open_document_with_buffer(magicPtr: number, bufferPtr: number): number;
  _wasm_drop_document(ptr: number): void;
  _wasm_count_pages(docPtr: number): number;
  _wasm_load_page(docPtr: number, index: number): number;
  _wasm_drop_page(ptr: number): void;
  _wasm_bound_page(pagePtr: number, boxIdx: number): number;
  _wasm_pdf_page_get_obj(pagePtr: number): number;
  _wasm_pdf_dict_gets_inheritable(objPtr: number, keyPtr: number): number;
  _wasm_pdf_is_number(objPtr: number): number;
  _wasm_pdf_is_array(objPtr: number): number;
  _wasm_pdf_array_len(arrPtr: number): number;
  _wasm_pdf_array_get(arrPtr: number, i: number): number;
  _wasm_pdf_to_real(objPtr: number): number;
  _wasm_new_stext_page_from_page(pagePtr: number, optionsPtr: number): number;
  _wasm_drop_stext_page(ptr: number): void;
  _wasm_stext_page_get_first_block(stextPtr: number): number;
  _wasm_stext_block_get_next(blockPtr: number): number;
  _wasm_stext_block_get_type(blockPtr: number): number;
  _wasm_stext_block_get_bbox(blockPtr: number): number;
  _wasm_stext_block_get_first_line(blockPtr: number): number;
  _wasm_stext_line_get_next(linePtr: number): number;
  _wasm_stext_line_get_bbox(linePtr: number): number;
  _wasm_stext_line_get_first_char(linePtr: number): number;
  _wasm_stext_char_get_next(charPtr: number): number;
  _wasm_stext_char_get_c(charPtr: number): number;
  _wasm_stext_char_get_quad(charPtr: number): number;
}

/** Same non-BMP-safe rune decode as beaver's mupdfApi.ts sanitizeRune. */
export function sanitizeRune(runeCode: number): string {
  if (runeCode >= 0xd800 && runeCode <= 0xdfff) {
    return "�";
  }
  return String.fromCodePoint(runeCode);
}

export interface StructuredTextWalker {
  beginLine?(bbox: RectTuple): void;
  onChar?(rune: string, quad: QuadTuple): void;
  endLine?(): void;
}

export interface MupdfPageGeometry {
  viewBox: RectTuple;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
}

export interface MupdfBridge {
  openDocument(data: Uint8Array | ArrayBuffer): {
    countPages(): number;
    loadPage(index: number): {
      getGeometry(): MupdfPageGeometry;
      walkText(walker: StructuredTextWalker): void;
      destroy(): void;
    };
    destroy(): void;
  };
}

/**
 * Build the JS wrapper around a booted libmupdf module. Allocates a small
 * amount of persistent WASM heap (the UTF8 scratch slot), so -- like
 * beaver's makeDocumentApi -- this should be called once and cached for
 * the worker's lifetime, not per-request.
 */
export function makeMupdfBridge(libmupdf: LibMuPdf): MupdfBridge {
  const Malloc = (size: number) => libmupdf._wasm_malloc(size);
  const Free = (ptr: number) => libmupdf._wasm_free(ptr);

  const allocateUTF8 = (str: string) => {
    const size = libmupdf.lengthBytesUTF8(str) + 1;
    const ptr = Malloc(size);
    libmupdf.stringToUTF8(str, ptr, size);
    return ptr;
  };

  // Scratch UTF8 slot, freed and reallocated on every STRING() call so we
  // never accumulate per-op allocations beyond a single live slot.
  const stringSlot: [number] = [0];
  const STRING = (s: string): number => {
    if (stringSlot[0]) {
      Free(stringSlot[0]);
      stringSlot[0] = 0;
    }
    return (stringSlot[0] = allocateUTF8(s));
  };

  const createBuffer = (data: Uint8Array | ArrayBuffer): number => {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    const dataPtr = Malloc(bytes.byteLength);
    libmupdf.HEAPU8.set(bytes, dataPtr);
    return libmupdf._wasm_new_buffer_from_data(dataPtr, bytes.byteLength);
  };

  const fromRect = (ptr: number): RectTuple => {
    const a = ptr >> 2;
    return [
      libmupdf.HEAPF32[a + 0],
      libmupdf.HEAPF32[a + 1],
      libmupdf.HEAPF32[a + 2],
      libmupdf.HEAPF32[a + 3],
    ];
  };

  const fromQuad = (ptr: number): QuadTuple => {
    const a = ptr >> 2;
    return [
      libmupdf.HEAPF32[a + 0],
      libmupdf.HEAPF32[a + 1],
      libmupdf.HEAPF32[a + 2],
      libmupdf.HEAPF32[a + 3],
      libmupdf.HEAPF32[a + 4],
      libmupdf.HEAPF32[a + 5],
      libmupdf.HEAPF32[a + 6],
      libmupdf.HEAPF32[a + 7],
    ];
  };

  const readBoxArray = (pageObj: number, key: string): RectTuple | null => {
    const arr = libmupdf._wasm_pdf_dict_gets_inheritable(pageObj, STRING(key));
    if (
      !arr ||
      !libmupdf._wasm_pdf_is_array(arr) ||
      libmupdf._wasm_pdf_array_len(arr) < 4
    ) {
      return null;
    }
    const out: number[] = [];
    for (let i = 0; i < 4; i++) {
      const elem = libmupdf._wasm_pdf_array_get(arr, i);
      if (!elem || !libmupdf._wasm_pdf_is_number(elem)) return null;
      const v = libmupdf._wasm_pdf_to_real(elem);
      if (!Number.isFinite(v)) return null;
      out.push(v);
    }
    const x0 = Math.min(out[0], out[2]);
    const y0 = Math.min(out[1], out[3]);
    const x1 = Math.max(out[0], out[2]);
    const y1 = Math.max(out[1], out[3]);
    if (!(x1 > x0) || !(y1 > y0)) return null;
    return [x0, y0, x1, y1];
  };

  const intersectBoxes = (a: RectTuple, b: RectTuple): RectTuple | null => {
    const x0 = Math.max(a[0], b[0]);
    const y0 = Math.max(a[1], b[1]);
    const x1 = Math.min(a[2], b[2]);
    const y1 = Math.min(a[3], b[3]);
    if (!(x1 > x0) || !(y1 > y0)) return null;
    return [x0, y0, x1, y1];
  };

  function getViewBox(pagePtr: number): RectTuple {
    const pageObj = libmupdf._wasm_pdf_page_get_obj(pagePtr);
    if (!pageObj) return [0, 0, 612, 792];
    const cropBox = readBoxArray(pageObj, "CropBox");
    const mediaBox = readBoxArray(pageObj, "MediaBox") ?? [0, 0, 612, 792];
    if (cropBox) return intersectBoxes(cropBox, mediaBox) ?? mediaBox;
    return mediaBox;
  }

  function getRotation(pagePtr: number): 0 | 90 | 180 | 270 {
    const pageObj = libmupdf._wasm_pdf_page_get_obj(pagePtr);
    if (!pageObj) return 0;
    const rotateObj = libmupdf._wasm_pdf_dict_gets_inheritable(
      pageObj,
      STRING("Rotate"),
    );
    if (!rotateObj || !libmupdf._wasm_pdf_is_number(rotateObj)) return 0;
    const value = libmupdf._wasm_pdf_to_real(rotateObj);
    if (!Number.isFinite(value) || value % 90 !== 0) return 0;
    return (((value % 360) + 360) % 360) as 0 | 90 | 180 | 270;
  }

  function walkText(pagePtr: number, walker: StructuredTextWalker): void {
    const optionsPtr = STRING("");
    const stextPtr = libmupdf._wasm_new_stext_page_from_page(
      pagePtr,
      optionsPtr,
    );
    if (!stextPtr) throw new Error("Failed to create structured text");
    try {
      let block = libmupdf._wasm_stext_page_get_first_block(stextPtr);
      while (block) {
        const blockType = libmupdf._wasm_stext_block_get_type(block);
        if (blockType !== 1) {
          // Text block (type !== image).
          let line = libmupdf._wasm_stext_block_get_first_line(block);
          while (line) {
            const lineBBox = fromRect(libmupdf._wasm_stext_line_get_bbox(line));
            walker.beginLine?.(lineBBox);
            if (walker.onChar) {
              let ch = libmupdf._wasm_stext_line_get_first_char(line);
              while (ch) {
                const runeCode = libmupdf._wasm_stext_char_get_c(ch);
                const rune = sanitizeRune(runeCode);
                const quad = fromQuad(libmupdf._wasm_stext_char_get_quad(ch));
                walker.onChar(rune, quad);
                ch = libmupdf._wasm_stext_char_get_next(ch);
              }
            }
            walker.endLine?.();
            line = libmupdf._wasm_stext_line_get_next(line);
          }
        }
        block = libmupdf._wasm_stext_block_get_next(block);
      }
    } finally {
      libmupdf._wasm_drop_stext_page(stextPtr);
    }
  }

  return {
    openDocument(data) {
      const bufferPtr = createBuffer(data);
      const magicPtr = STRING("application/pdf");
      const docPtr = libmupdf._wasm_open_document_with_buffer(
        magicPtr,
        bufferPtr,
      );
      libmupdf._wasm_drop_buffer(bufferPtr);
      if (!docPtr) throw new Error("Failed to open document");
      return {
        countPages: () => libmupdf._wasm_count_pages(docPtr),
        loadPage(index: number) {
          const pagePtr = libmupdf._wasm_load_page(docPtr, index);
          if (!pagePtr) throw new Error(`Failed to load page ${index}`);
          return {
            getGeometry(): MupdfPageGeometry {
              const viewBox = getViewBox(pagePtr);
              return {
                viewBox,
                width: viewBox[2] - viewBox[0],
                height: viewBox[3] - viewBox[1],
                rotation: getRotation(pagePtr),
              };
            },
            walkText: (walker: StructuredTextWalker) =>
              walkText(pagePtr, walker),
            destroy: () => libmupdf._wasm_drop_page(pagePtr),
          };
        },
        destroy: () => libmupdf._wasm_drop_document(docPtr),
      };
    },
  };
}
