// List the part names inside an .xlsx (ZIP) without decompressing, by reading the central directory.
export function listZipParts(buf: ArrayBuffer): string[] {
  const v = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not_zip');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const names: string[] = [];
  const dec = new TextDecoder();
  for (let n = 0; n < count && p + 46 <= buf.byteLength; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    names.push(dec.decode(u8.subarray(p + 46, p + 46 + nameLen)));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

export interface FeatureScan {
  charts: number;
  drawings: number;
  images: number;
  pivots: number;
  macros: boolean;
  externalLinks: number;
  comments: number;
  tables: number;
}

export function scanFeatures(parts: string[]): FeatureScan {
  const c = (re: RegExp) => parts.filter((p) => re.test(p)).length;
  return {
    charts: c(/^xl\/charts\/chart\d+\.xml$/),
    drawings: c(/^xl\/drawings\/drawing\d+\.xml$/),
    images: c(/^xl\/media\//),
    pivots: c(/^xl\/pivotTables\//),
    macros: parts.some((p) => /vbaProject\.bin$/i.test(p)),
    externalLinks: c(/^xl\/externalLinks\//),
    comments: c(/^xl\/comments\d*\.xml$/),
    tables: c(/^xl\/tables\//),
  };
}

/** Features the workbook writer cannot round-trip faithfully. */
export function unsupportedFeatures(f: FeatureScan): string[] {
  const out: string[] = [];
  if (f.charts) out.push(`رسوم بيانية (${f.charts})`);
  if (f.pivots) out.push('جداول محورية');
  if (f.macros) out.push('وحدات ماكرو');
  if (f.externalLinks) out.push('روابط لملفات خارجية');
  if (f.drawings && !f.charts) out.push('أشكال مرسومة');
  return out;
}
