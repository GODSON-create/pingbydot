/**
 * Zero-dependency ISO/IEC 18004 QR Code encoder (Byte mode, Error Correction Level L,
 * Versions 2..5 single-block Reed-Solomon GF(256)) producing crisp deterministic SVG paths.
 *
 * Used on `/download` so mobile visitors can scan the official Ping download link
 * with zero third-party image requests, zero tracking leaks, and full offline support.
 */

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(function initGaloisField() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255]!;
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a]! + GF_LOG[b]!]!;
}

function rsGeneratorPoly(ecCount: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < ecCount; i++) {
    const next = new Uint8Array(poly.length + 1);
    const factor = GF_EXP[i]!;
    for (let j = 0; j < poly.length; j++) {
      next[j] = (next[j]! ^ poly[j]!) & 0xff;
      next[j + 1] = (next[j + 1]! ^ gfMul(poly[j]!, factor)) & 0xff;
    }
    poly = next;
  }
  return poly;
}

function rsComputeEc(data: Uint8Array, ecCount: number): Uint8Array {
  const gen = rsGeneratorPoly(ecCount);
  const rem = new Uint8Array(ecCount);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i]! ^ rem[0]!;
    rem.copyWithin(0, 1);
    rem[ecCount - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < ecCount; j++) {
        rem[j] = (rem[j]! ^ gfMul(gen[j + 1]!, factor)) & 0xff;
      }
    }
  }
  return rem;
}

interface QrVersionSpec {
  version: number;
  size: number;
  dataCodewords: number;
  ecCodewords: number;
  maxBytes: number;
  alignCenter: number;
}

// ISO/IEC 18004 single-block ECC-L tables (Versions 2..5 cover up to 106 UTF-8 bytes)
const VERSION_SPECS: QrVersionSpec[] = [
  { version: 2, size: 25, dataCodewords: 34, ecCodewords: 10, maxBytes: 32, alignCenter: 18 },
  { version: 3, size: 29, dataCodewords: 55, ecCodewords: 15, maxBytes: 53, alignCenter: 22 },
  { version: 4, size: 33, dataCodewords: 80, ecCodewords: 20, maxBytes: 78, alignCenter: 26 },
  { version: 5, size: 37, dataCodewords: 108, ecCodewords: 26, maxBytes: 106, alignCenter: 30 },
];

function encodeByteCodewords(bytes: Uint8Array, spec: QrVersionSpec): Uint8Array {
  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >>> i) & 1);
    }
  };

  // Mode indicator 0100 (Byte), 8-bit character count for Versions 1..9
  pushBits(0b0100, 4);
  pushBits(bytes.length, 8);
  for (let i = 0; i < bytes.length; i++) {
    pushBits(bytes[i]!, 8);
  }

  const capacityBits = spec.dataCodewords * 8;
  const terminator = Math.min(4, capacityBits - bits.length);
  pushBits(0, terminator);

  while (bits.length % 8 !== 0) bits.push(0);

  const codewords = new Uint8Array(spec.dataCodewords);
  let idx = 0;
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]!;
    codewords[idx++] = b;
  }

  const pads = [0xec, 0x11];
  let padIdx = 0;
  while (idx < spec.dataCodewords) {
    codewords[idx++] = pads[padIdx++ & 1]!;
  }
  return codewords;
}

function formatBitsForMask(mask: number): number {
  // ECC Level L = 01
  const data = (0b01 << 3) | (mask & 0b111);
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function maskPredicate(mask: number, r: number, c: number): boolean {
  switch (mask) {
    case 0:
      return (r + c) % 2 === 0;
    case 1:
      return r % 2 === 0;
    case 2:
      return c % 3 === 0;
    case 3:
      return (r + c) % 3 === 0;
    case 4:
      return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5:
      return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6:
      return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    case 7:
      return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    default:
      return false;
  }
}

export interface QrMatrix {
  version: number;
  size: number;
  modules: boolean[][];
}

export function generateQrMatrix(text: string): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  const spec = VERSION_SPECS.find((s) => bytes.length <= s.maxBytes);
  if (!spec) {
    throw new Error(`QR payload exceeds supported length (${bytes.length} bytes > 106 bytes).`);
  }

  const dataCw = encodeByteCodewords(bytes, spec);
  const ecCw = rsComputeEc(dataCw, spec.ecCodewords);
  const allCodewords = new Uint8Array(dataCw.length + ecCw.length);
  allCodewords.set(dataCw, 0);
  allCodewords.set(ecCw, dataCw.length);

  const size = spec.size;
  const isFunc: boolean[][] = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const base: boolean[][] = Array.from({ length: size }, () => Array<boolean>(size).fill(false));

  const setFunc = (r: number, c: number, dark: boolean) => {
    if (r < 0 || c < 0 || r >= size || c >= size) return;
    isFunc[r]![c] = true;
    base[r]![c] = dark;
  };

  // Finder patterns + 1-module separators
  const drawFinder = (top: number, left: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const inBox = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const dark =
          inBox &&
          (dr === 0 ||
            dr === 6 ||
            dc === 0 ||
            dc === 6 ||
            (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
        setFunc(top + dr, left + dc, dark);
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Alignment pattern (Versions 2..5 have exactly one at (alignCenter, alignCenter))
  const ac = spec.alignCenter;
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      const dist = Math.max(Math.abs(dr), Math.abs(dc));
      setFunc(ac + dr, ac + dc, dist !== 1);
    }
  }

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setFunc(6, i, i % 2 === 0);
    setFunc(i, 6, i % 2 === 0);
  }

  // Dark module & reserved format info cells
  setFunc(size - 8, 8, true);
  for (let i = 0; i < 9; i++) {
    if (!isFunc[8]![i]) setFunc(8, i, false);
    if (!isFunc[i]![8]) setFunc(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    if (!isFunc[8]![size - 1 - i]) setFunc(8, size - 1 - i, false);
    if (!isFunc[size - 1 - i]![8]) setFunc(size - 1 - i, 8, false);
  }

  // Place data bits in upward/downward 2-column zigzag
  let bitIdx = 0;
  const totalBits = allCodewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((size - 1 - right) >> 1) % 2 === 0;
    for (let step = 0; step < size; step++) {
      const r = upward ? size - 1 - step : step;
      for (let colOff = 0; colOff < 2; colOff++) {
        const c = right - colOff;
        if (!isFunc[r]![c]) {
          let dark = false;
          if (bitIdx < totalBits) {
            dark = ((allCodewords[bitIdx >>> 3]! >>> (7 - (bitIdx & 7))) & 1) === 1;
            bitIdx++;
          }
          base[r]![c] = dark;
        }
      }
    }
  }

  // Evaluate masks 0..7 using standard run-length + 2x2 block + balance penalty
  let bestMask = 0;
  let bestPenalty = Number.POSITIVE_INFINITY;
  let bestModules: boolean[][] = base;

  for (let mask = 0; mask < 8; mask++) {
    const candidate = base.map((row, r) =>
      row.map((cell, c) => (isFunc[r]![c] ? cell : cell !== maskPredicate(mask, r, c))),
    );
    const fmt = formatBitsForMask(mask);
    // Write 15 format bits into both copies
    for (let i = 0; i <= 5; i++) candidate[8]![i] = ((fmt >>> (14 - i)) & 1) === 1;
    candidate[8]![7] = ((fmt >>> 8) & 1) === 1;
    candidate[8]![8] = ((fmt >>> 7) & 1) === 1;
    candidate[7]![8] = ((fmt >>> 6) & 1) === 1;
    for (let i = 0; i <= 5; i++) candidate[5 - i]![8] = ((fmt >>> (5 - i)) & 1) === 1;

    for (let i = 0; i < 8; i++) candidate[8]![size - 1 - i] = ((fmt >>> i) & 1) === 1;
    for (let i = 0; i < 7; i++) candidate[size - 7 + i]![8] = ((fmt >>> (14 - i)) & 1) === 1;

    let penalty = 0;
    let darkCount = 0;
    for (let r = 0; r < size; r++) {
      let runLen = 1;
      for (let c = 0; c < size; c++) {
        if (candidate[r]![c]) darkCount++;
        if (c > 0) {
          if (candidate[r]![c] === candidate[r]![c - 1]) {
            runLen++;
          } else {
            if (runLen >= 5) penalty += 3 + (runLen - 5);
            runLen = 1;
          }
        }
        if (r > 0 && c > 0) {
          const v = candidate[r]![c];
          if (
            v === candidate[r - 1]![c] &&
            v === candidate[r]![c - 1] &&
            v === candidate[r - 1]![c - 1]
          ) {
            penalty += 3;
          }
        }
      }
      if (runLen >= 5) penalty += 3 + (runLen - 5);
    }
    const pct = (darkCount * 100) / (size * size);
    penalty += Math.floor(Math.abs(pct - 50) / 5) * 10;

    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMask = mask;
      bestModules = candidate;
    }
  }

  void bestMask;
  return { version: spec.version, size, modules: bestModules };
}

/**
 * Generates an SVG `<path d="..." />` string and viewBox dimension (with 4-module quiet zone)
 * for crisp inline SVG QR rendering.
 */
export function generateQrSvgPath(
  text: string,
  quietZone = 4,
): { viewBoxSize: number; path: string; version: number; size: number } {
  const { version, size, modules } = generateQrMatrix(text);
  const parts: string[] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r]![c]) {
        parts.push(`M${c + quietZone},${r + quietZone}h1v1h-1z`);
      }
    }
  }
  return {
    viewBoxSize: size + quietZone * 2,
    path: parts.join(""),
    version,
    size,
  };
}
