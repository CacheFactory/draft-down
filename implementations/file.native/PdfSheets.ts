// @archigraph file.native
// Minimal PDF writer: one landscape page per scene, each holding a JPEG
// (DCTDecode — embeddable verbatim, no compression code needed) and a title
// block line. No dependencies.

interface SheetInput {
  title: string;
  /** JPEG bytes (from canvas.toDataURL('image/jpeg')). */
  jpeg: Uint8Array;
  widthPx: number;
  heightPx: number;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1];
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function sheetFromDataUrl(title: string, jpegDataUrl: string, widthPx: number, heightPx: number): SheetInput {
  return { title, jpeg: dataUrlToBytes(jpegDataUrl), widthPx, heightPx };
}

/** Build a complete PDF (A4 landscape, 842×595pt) from sheets. */
export function buildPdf(sheets: SheetInput[], modelName: string): ArrayBuffer {
  const PAGE_W = 842, PAGE_H = 595, MARGIN = 36;
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let position = 0;

  const push = (data: Uint8Array | string) => {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    chunks.push(bytes);
    position += bytes.length;
  };
  const beginObj = (num: number) => {
    offsets[num] = position;
    push(`${num} 0 obj\n`);
  };

  // Object numbering: 1 catalog, 2 pages tree, then per sheet:
  // page, contents, image (3 objects each), finally font.
  const pageObjNums: number[] = [];
  const fontObjNum = 3 + sheets.length * 3;

  push('%PDF-1.4\n');

  beginObj(1);
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  const kids = sheets.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  beginObj(2);
  push(`<< /Type /Pages /Kids [${kids}] /Count ${sheets.length} >>\nendobj\n`);

  const date = new Date().toLocaleDateString();
  sheets.forEach((sheet, i) => {
    const pageNum = 3 + i * 3;
    const contentNum = pageNum + 1;
    const imageNum = pageNum + 2;
    pageObjNums.push(pageNum);

    // Fit the image into the page with margins + title strip
    const availW = PAGE_W - MARGIN * 2;
    const availH = PAGE_H - MARGIN * 2 - 24;
    const s = Math.min(availW / sheet.widthPx, availH / sheet.heightPx);
    const w = sheet.widthPx * s;
    const h = sheet.heightPx * s;
    const x = (PAGE_W - w) / 2;
    const y = (PAGE_H - 24 - h) / 2 + 24;

    const escape = (t: string) => t.replace(/[\\()]/g, c => `\\${c}`);
    const content =
      `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im${i} Do Q\n` +
      `BT /F1 11 Tf ${MARGIN} ${MARGIN - 14 + 24} Td ` +
      `(${escape(`${modelName} — ${sheet.title} — ${date}`)}) Tj ET\n`;
    const contentBytes = encoder.encode(content);

    beginObj(pageNum);
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
         `/Resources << /XObject << /Im${i} ${imageNum} 0 R >> /Font << /F1 ${fontObjNum} 0 R >> >> ` +
         `/Contents ${contentNum} 0 R >>\nendobj\n`);

    beginObj(contentNum);
    push(`<< /Length ${contentBytes.length} >>\nstream\n`);
    push(contentBytes);
    push('\nendstream\nendobj\n');

    beginObj(imageNum);
    push(`<< /Type /XObject /Subtype /Image /Width ${sheet.widthPx} /Height ${sheet.heightPx} ` +
         `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${sheet.jpeg.length} >>\nstream\n`);
    push(sheet.jpeg);
    push('\nendstream\nendobj\n');
  });

  beginObj(fontObjNum);
  push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');

  // xref
  const xrefStart = position;
  const totalObjs = fontObjNum + 1;
  push(`xref\n0 ${totalObjs}\n`);
  push('0000000000 65535 f \n');
  for (let i = 1; i < totalObjs; i++) {
    push(`${String(offsets[i] ?? 0).padStart(10, '0')} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);

  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out.buffer;
}
