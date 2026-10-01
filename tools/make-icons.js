/*
 * Glass Lab — génère les icônes PWA (PNG) sans dépendance : node tools/make-icons.js
 * Dessin : fond sombre, vitre (cadre), balle jaune et son ombre. Zone de sécurité « maskable » respectée.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x / size, y / size, size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const BG = [11, 18, 25];
const TURF = [36, 99, 176];
const GLASS = [212, 244, 255];
const BALL = [242, 255, 31];
const EDGE = [46, 51, 0];

/** Couleur d'un pixel (u, v ∈ [0, 1]) avec anticrénelage simple par sur-échantillonnage. */
function shade(u, v) {
  // Sol (moitié basse), vitre de fond (cadre clair), balle et ombre
  let c = v > 0.62 ? TURF : BG;
  const inGlass = u > 0.18 && u < 0.82 && v > 0.2 && v < 0.62;
  const border = inGlass && (u < 0.215 || u > 0.785 || v < 0.235 || v > 0.6);
  if (inGlass) c = border ? GLASS : [40, 62, 84];
  if (inGlass && !border && Math.abs(u - 0.5) < 0.012) c = GLASS; // montant central
  const sx = (u - 0.56) / 0.13;
  const sy = (v - 0.76) / 0.035;
  if (sx * sx + sy * sy < 1) c = [12, 30, 56]; // ombre
  const d = Math.hypot(u - 0.52, v - 0.47);
  if (d < 0.135) c = d > 0.118 ? EDGE : BALL;
  return c;
}

for (const size of [192, 512]) {
  const ss = 3;
  const data = png(size, (u, v, n) => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < ss; i++) {
      for (let j = 0; j < ss; j++) {
        const c = shade(u + (i + 0.5) / (ss * n), v + (j + 0.5) / (ss * n));
        r += c[0];
        g += c[1];
        b += c[2];
      }
    }
    const k = ss * ss;
    return [Math.round(r / k), Math.round(g / k), Math.round(b / k), 255];
  });
  writeFileSync(new URL(`../icons/icon-${size}.png`, import.meta.url), data);
  console.log(`icons/icon-${size}.png (${data.length} octets)`);
}
