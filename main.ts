// One image summing up the world's news of Monday 23 November 2026.
//
// The program draws a newspaper front page in code — no network, no
// bundled image — and writes it to /output/entry.png as a whole PNG
// (at most 1 MiB, 1024 by 1024). It is fully deterministic: the same
// bytes on every run. Node 22 standard library only.
//
// Layout (1024 x 1024):
//   masthead band ............ the date, big, so the day is unmistakable
//   2 x 2 story grid ......... COP31, Nvidia, Poland/NATO, Ukraine warship
//   bottom strip ............. four one-line briefs from four more beats
//
// Run it: mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------
type RGB = [number, number, number];
const PAPER: RGB = [246, 241, 227];
const INK: RGB = [26, 26, 26];
const NAVY: RGB = [16, 35, 63];
const WHITE: RGB = [255, 255, 255];
const RED: RGB = [192, 57, 43];
const TEAL: RGB = [14, 124, 123];
const GREEN: RGB = [30, 122, 52];
const BLUE: RGB = [36, 86, 166];
const STEEL: RGB = [74, 90, 106];
const CELL: RGB = [255, 255, 255];
const MUTED: RGB = [90, 90, 84];

// ---------------------------------------------------------------------------
// Pixel buffer
// ---------------------------------------------------------------------------
const buf = new Uint8Array(W * H * 3);
function px(x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  buf[i] = c[0];
  buf[i + 1] = c[1];
  buf[i + 2] = c[2];
}
function fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(W, x + w);
  const y1 = Math.min(H, y + h);
  for (let yy = y0; yy < y1; yy++) {
    let i = (yy * W + x0) * 3;
    for (let xx = x0; xx < x1; xx++) {
      buf[i] = c[0];
      buf[i + 1] = c[1];
      buf[i + 2] = c[2];
      i += 3;
    }
  }
}
function hline(x0: number, x1: number, y: number, c: RGB): void {
  if (y < 0 || y >= H) return;
  const a = Math.max(0, Math.min(x0, x1));
  const b = Math.min(W - 1, Math.max(x0, x1));
  for (let x = a; x <= b; x++) px(x, y, c);
}
function line(x0: number, y0: number, x1: number, y1: number, c: RGB, w = 1): void {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  for (;;) {
    if (w <= 1) px(x, y, c);
    else fillRect(x - ((w / 2) | 0), y - ((w / 2) | 0), w, w, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}
function fillCircle(cx: number, cy: number, r: number, c: RGB): void {
  for (let dy = -r; dy <= r; dy++) {
    const dx = Math.floor(Math.sqrt(r * r - dy * dy));
    hline(cx - dx, cx + dx, cy + dy, c);
  }
}
function ring(cx: number, cy: number, r: number, t: number, c: RGB): void {
  for (let dy = -r; dy <= r; dy++) {
    const outer = Math.floor(Math.sqrt(r * r - dy * dy));
    const inner = r - t > 0 ? Math.floor(Math.sqrt((r - t) * (r - t) - dy * dy)) : -1;
    if (inner >= 0) {
      hline(cx - outer, cx - inner - 1, cy + dy, c);
      hline(cx + inner + 1, cx + outer, cy + dy, c);
    } else {
      hline(cx - outer, cx + outer, cy + dy, c);
    }
  }
}
// Scanline fill of a simple polygon (even-odd rule).
function fillPoly(pts: [number, number][], c: RGB): void {
  let minY = H;
  let maxY = 0;
  for (const [, y] of pts) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  for (let y = Math.max(0, minY); y <= Math.min(H - 1, maxY); y++) {
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1) % pts.length];
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
        xs.push(Math.round(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0)));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) hline(xs[k], xs[k + 1], y, c);
  }
}

// ---------------------------------------------------------------------------
// PNG encoder (colour type 2, 8-bit, filter 0 on every scanline)
// ---------------------------------------------------------------------------
const CRC_TABLE: number[] = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t.push(c >>> 0);
  }
  return t;
})();
function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePNG(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0;
    raw.set(buf.subarray(y * W * 3, (y + 1) * W * 3), y * (1 + W * 3) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// 5x7 bitmap font (each glyph: 7 rows, 5 bits, MSB = leftmost column).
// All text is set in capitals; anything unmapped draws blank.
// ---------------------------------------------------------------------------
const FONT: Record<string, number[]> = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0a],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  '0': [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  '1': [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  '2': [0x0e, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1f],
  '3': [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  '4': [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  '5': [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  '6': [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  '7': [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  '8': [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  '9': [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '.': [0, 0, 0, 0, 0, 0x0c, 0x0c],
  ',': [0, 0, 0, 0, 0x0c, 0x04, 0x08],
  ':': [0, 0x0c, 0x0c, 0, 0x0c, 0x0c, 0],
  ';': [0, 0x0c, 0x0c, 0, 0x0c, 0x04, 0x08],
  '-': [0, 0, 0, 0x0e, 0, 0, 0],
  '!': [0x04, 0x04, 0x04, 0x04, 0x04, 0, 0x04],
  '?': [0x0e, 0x11, 0x01, 0x06, 0x04, 0, 0x04],
  '/': [0x01, 0x02, 0x02, 0x04, 0x08, 0x08, 0x10],
  '(': [0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02],
  ')': [0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08],
  '&': [0x0c, 0x12, 0x14, 0x08, 0x15, 0x12, 0x0d],
  '%': [0x19, 0x1a, 0x02, 0x04, 0x08, 0x0b, 0x13],
  $: [0x04, 0x0f, 0x14, 0x0e, 0x05, 0x1e, 0x04],
  '+': [0, 0x04, 0x04, 0x1f, 0x04, 0x04, 0],
  '=': [0, 0, 0x1f, 0, 0x1f, 0, 0],
  "'": [0x04, 0x04, 0x08, 0, 0, 0, 0],
  '\u2022': [0, 0, 0x0e, 0x0e, 0x0e, 0, 0],
  '\u00b7': [0, 0, 0, 0x0c, 0x0c, 0, 0],
  '\u00d7': [0, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0],
};
const BLANK = [0, 0, 0, 0, 0, 0, 0];
function glyphOf(ch: string): number[] {
  if (ch === '\u2019' || ch === '\u2018') return FONT["'"];
  if (ch === '\u2014' || ch === '\u2013') return FONT['-'];
  return FONT[ch] ?? BLANK;
}
// Advance per character at a scale: 6 columns (5 glyph + 1 space).
function textWidth(s: string, scale: number): number {
  const t = s.toUpperCase();
  return t.length === 0 ? 0 : t.length * 6 * scale - scale;
}
function drawGlyph(ch: string, x: number, y: number, scale: number, c: RGB): void {
  const g = glyphOf(ch.toUpperCase());
  for (let r = 0; r < 7; r++) {
    const row = g[r];
    for (let col = 0; col < 5; col++) {
      if ((row >> (4 - col)) & 1) fillRect(x + col * scale, y + r * scale, scale, scale, c);
    }
  }
}
function drawText(s: string, x: number, y: number, scale: number, c: RGB): void {
  const t = s.toUpperCase();
  for (let i = 0; i < t.length; i++) drawGlyph(t[i], x + i * 6 * scale, y, scale, c);
}
function drawTextCentred(s: string, cx: number, y: number, scale: number, c: RGB): void {
  drawText(s, cx - Math.floor(textWidth(s, scale) / 2), y, scale, c);
}
// Greedy word wrap; a word longer than maxWidth is split by character.
function wrapText(s: string, scale: number, maxWidth: number): string[] {
  const words = s.toUpperCase().split(' ');
  const lines: string[] = [];
  let cur = '';
  const push = (w: string) => {
    if (textWidth(w, scale) <= maxWidth) {
      if (cur === '') cur = w;
      else if (textWidth(cur + ' ' + w, scale) <= maxWidth) cur += ' ' + w;
      else {
        lines.push(cur);
        cur = w;
      }
    } else {
      // Split the over-long word across lines.
      let rest = w;
      while (rest !== '') {
        if (cur !== '' && textWidth(cur + ' ' + rest.slice(0, 1), scale) > maxWidth) {
          lines.push(cur);
          cur = '';
        }
        let take = 0;
        while (
          take < rest.length &&
          textWidth((cur === '' ? '' : cur + ' ') + rest.slice(0, take + 1), scale) <= maxWidth
        ) {
          take++;
        }
        if (take === 0) take = 1;
        cur = (cur === '' ? '' : cur + ' ') + rest.slice(0, take);
        rest = rest.slice(take);
        if (rest !== '' && textWidth(cur, scale) >= maxWidth - 6 * scale) {
          lines.push(cur);
          cur = '';
        }
      }
    }
  };
  for (const w of words) push(w);
  if (cur !== '') lines.push(cur);
  return lines;
}

// ---------------------------------------------------------------------------
// The day's news (Monday 23 November 2026, as reported that day)
// ---------------------------------------------------------------------------
type Story = {
  kicker: string;
  headline: string;
  body: string;
  accent: RGB;
  tint: RGB;
  art: 'globe' | 'chart' | 'shield' | 'ship';
  word: string;
  wordColor: RGB;
};
const STORIES: Story[] = [
  {
    kicker: 'CLIMATE - ANTALYA, TURKEY',
    headline: 'CLIMATE TALKS COLLAPSE',
    body: 'COP31 ends with no deal. Oil producers block a fossil-fuel pledge; 190 nations leave Antalya empty-handed.',
    accent: TEAL,
    tint: [227, 240, 238],
    art: 'globe',
    word: 'NO DEAL',
    wordColor: RED,
  },
  {
    kicker: 'MARKETS - WALL STREET',
    headline: 'NVIDIA SOARS AS HUANG RETURNS',
    body: 'Board reinstates Jensen Huang as chief executive. Shares jump 31%; Nasdaq gains 6.5% in a relief rally.',
    accent: GREEN,
    tint: [230, 242, 228],
    art: 'chart',
    word: '+31%',
    wordColor: GREEN,
  },
  {
    kicker: 'EUROPE - SECURITY',
    headline: 'MISSILES LAND IN POLAND',
    body: 'Russian cruise missiles come down in Poland. NATO calls emergency talks and sends early-warning aircraft.',
    accent: BLUE,
    tint: [228, 234, 247],
    art: 'shield',
    word: 'NATO',
    wordColor: BLUE,
  },
  {
    kicker: 'WAR IN UKRAINE - LIBYA',
    headline: 'UKRAINE SINKS RUSSIAN WARSHIP',
    body: 'Naval drones sink the corvette Mercury off Benghazi. Kyiv also hits Russian oil sites in Rostov and Perm.',
    accent: STEEL,
    tint: [232, 236, 240],
    art: 'ship',
    word: 'SUNK',
    wordColor: RED,
  },
];
const BRIEFS = [
  'DEMOCRATS WIN 258 HOUSE SEATS',
  '24 KILLED IN INDONESIA FACTORY FIRE',
  'INDIA GIVES NEPAL $1.62B FLOOD AID',
  'CHINA NAMES SHENZHOU-24 CREW',
];

// ---------------------------------------------------------------------------
// Pictograms (drawn into a band at bx, by, 466 x 140)
// ---------------------------------------------------------------------------
function star(cx: number, cy: number, rO: number, rI: number, c: RGB): void {
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? rO : rI;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push([Math.round(cx + r * Math.cos(a)), Math.round(cy + r * Math.sin(a))]);
  }
  fillPoly(pts, c);
}
function drawArt(kind: Story['art'], bx: number, by: number, accent: RGB): void {
  if (kind === 'globe') {
    const cx = bx + 92;
    const cy = by + 70;
    ring(cx, cy, 46, 7, accent);
    line(cx - 46, cy, cx + 46, cy, accent, 4);
    line(cx, cy - 46, cx, cy + 46, accent, 4);
    line(cx - 32, cy - 32, cx + 32, cy + 32, accent, 4);
    line(cx + 32, cy - 32, cx - 32, cy + 32, accent, 4);
    line(bx + 38, by + 118, bx + 146, by + 22, RED, 11);
  } else if (kind === 'chart') {
    line(bx + 36, by + 112, bx + 36, by + 24, accent, 5);
    line(bx + 36, by + 112, bx + 208, by + 112, accent, 5);
    const pts: [number, number][] = [
      [bx + 42, by + 100],
      [bx + 84, by + 92],
      [bx + 118, by + 96],
      [bx + 150, by + 62],
      [bx + 186, by + 30],
    ];
    for (let i = 0; i + 1 < pts.length; i++) {
      line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], accent, 7);
    }
    fillPoly(
      [
        [bx + 186, by + 30],
        [bx + 164, by + 30],
        [bx + 186, by + 52],
      ],
      accent,
    );
  } else if (kind === 'shield') {
    fillPoly(
      [
        [bx + 44, by + 24],
        [bx + 140, by + 24],
        [bx + 140, by + 72],
        [bx + 92, by + 112],
        [bx + 44, by + 72],
      ],
      accent,
    );
    star(bx + 92, by + 62, 26, 11, WHITE);
  } else {
    // ship on waves
    fillPoly(
      [
        [bx + 30, by + 78],
        [bx + 176, by + 78],
        [bx + 158, by + 100],
        [bx + 48, by + 100],
      ],
      accent,
    );
    fillRect(bx + 88, by + 56, 42, 22, accent);
    line(bx + 109, by + 56, bx + 109, by + 30, accent, 5);
    fillPoly(
      [
        [bx + 109, by + 30],
        [bx + 109, by + 44],
        [bx + 134, by + 37],
      ],
      RED,
    );
    line(bx + 24, by + 112, bx + 182, by + 112, BLUE, 4);
    line(bx + 44, by + 124, bx + 162, by + 124, BLUE, 4);
  }
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
function drawMasthead(): void {
  fillRect(0, 0, W, 120, NAVY);
  drawTextCentred('MONDAY - THE WORLD IN ONE PICTURE', W / 2, 16, 2, [176, 196, 216]);
  drawTextCentred('23 NOVEMBER 2026', W / 2, 44, 8, WHITE);
  fillRect(0, 114, W, 6, RED);
}
function drawStory(s: Story, x: number, y: number): void {
  const w = 490;
  const h = 368;
  fillRect(x, y, w, h, CELL);
  // 3px border
  fillRect(x, y, w, 3, INK);
  fillRect(x, y + h - 3, w, 3, INK);
  fillRect(x, y, 3, h, INK);
  fillRect(x + w - 3, y, 3, h, INK);
  // Pictogram band
  const bx = x + 12;
  const by = y + 12;
  fillRect(bx, by, 466, 140, s.tint);
  drawArt(s.art, bx, by, s.accent);
  drawText(s.word, bx + 210, by + 48, 6, s.wordColor);
  // Kicker + rule
  drawText(s.kicker, x + 16, y + 168, 2, s.accent);
  fillRect(x + 16, y + 190, 64, 4, s.accent);
  // Headline
  const headLines = wrapText(s.headline, 4, 458).slice(0, 3);
  headLines.forEach((ln, i) => drawText(ln, x + 16, y + 204 + i * 34, 4, INK));
  // Body
  const bodyTop = y + 204 + headLines.length * 34 + 10;
  const bodyLines = wrapText(s.body, 2, 458).slice(0, 3);
  bodyLines.forEach((ln, i) => drawText(ln, x + 16, bodyTop + i * 20, 2, MUTED));
}
function drawStrip(): void {
  const y0 = 892;
  fillRect(0, y0, W, 6, RED);
  drawText('ALSO TODAY', 28, y0 + 20, 2, RED);
  drawText('WIRE REPORTS', W - 28 - textWidth('WIRE REPORTS', 2), y0 + 20, 2, MUTED);
  BRIEFS.forEach((b, i) => {
    const bx = 28 + (i % 2) * 496;
    const by = y0 + 52 + Math.floor(i / 2) * 38;
    drawText('\u2022', bx, by, 2, RED);
    drawText(b, bx + 18, by, 2, INK);
  });
}

function main(): void {
  fillRect(0, 0, W, H, PAPER);
  drawMasthead();
  STORIES.forEach((s, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    drawStory(s, 16 + col * 502, 132 + row * 380);
  });
  drawStrip();
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(outDir, { recursive: true });
  const png = encodePNG();
  writeFileSync(join(outDir, 'entry.png'), png);
  console.log(`wrote entry.png: ${png.length} bytes, ${W}x${H}`);
}

main();
