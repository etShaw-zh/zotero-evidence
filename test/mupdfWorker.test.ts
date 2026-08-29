import { assert } from "chai";
import { mupdfWorkerClient } from "../src/modules/pdf/mupdfWorkerClient";

const MINIMAL_PDF = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
5 0 obj
<< /Length 76 >>
stream
BT /F1 24 Tf 72 712 Td (MUPDF SMOKE TEST FIXTURE TEXT) Tj ET
endstream
endobj
xref
0 6
0000000000 65535 f
trailer
<< /Size 6 /Root 1 0 R >>
startxref
0
%%EOF
`;

function pdfBytes(): ArrayBuffer {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(MINIMAL_PDF);
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

// Integration test for the MuPDF extraction worker
// (src/modules/pdf/worker/, src/modules/pdf/mupdfWorkerClient.ts). Worker
// spawn + chrome:// WASM loading is fragile infrastructure -- if a future
// esbuild/scaffold config change breaks the worker bundle or asset
// copying, this is what would catch it (this exact combination had no
// prior precedent in this project, confirmed working here empirically).
describe("MuPDF worker (FTS-06/COD-04 highlight infrastructure)", function () {
  this.timeout(30000);

  it("worker loads, wasm instantiates, and can open a real PDF", async function () {
    const count = await mupdfWorkerClient.getPageCount(pdfBytes());
    assert.equal(count, 1);
  });

  it("extractPage returns geometry and character-level text", async function () {
    const page = await mupdfWorkerClient.extractPage(pdfBytes(), 0);
    assert.equal(page.geometry.width, 612);
    assert.equal(page.geometry.height, 792);
    assert.equal(page.geometry.rotation, 0);
    assert.isAbove(page.lines.length, 0, "should extract at least one line");
    const text = page.lines
      .map((l) => l.chars.map((c) => c.c).join(""))
      .join("\n");
    assert.include(text, "MUPDF SMOKE TEST FIXTURE TEXT");
  });
});
