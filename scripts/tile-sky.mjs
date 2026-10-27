/** Derive bounded, guttered sky tiles from NASA's separate 16k Milky Way EXR.
 * Usage: node scripts/tile-sky.mjs source.exr output-directory scratch-directory
 * Also accepts a normalized, linear RGB16 PPM from the documented FFmpeg step.
 * Requires macOS sips for JPEG encoding. No sharpening or synthesized detail.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { DataUtils, HalfFloatType } from 'three';

const [source, output, scratch, selectedRows] = process.argv.slice(2);
if (!source || !output || !scratch)
  throw new Error('Expected source.exr, output directory, scratch directory');
fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(scratch, { recursive: true });
const bytes = fs.readFileSync(source);
const ppm = source.endsWith('.ppm');
let map;
if (ppm) {
  const header = /^P6\s+(\d+)\s+(\d+)\s+65535\n/.exec(
    bytes.subarray(0, 100).toString('ascii'),
  );
  if (!header)
    throw new Error(
      'Expected a binary RGB16 PPM from the documented conversion',
    );
  const pixels = bytes.subarray(header[0].length);
  pixels.swap16();
  const aligned = pixels.byteOffset % 2 ? Uint8Array.from(pixels) : pixels;
  map = {
    width: +header[1],
    height: +header[2],
    data: new Uint16Array(
      aligned.buffer,
      aligned.byteOffset,
      aligned.byteLength / 2,
    ),
  };
} else {
  map = new EXRLoader()
    .setDataType(HalfFloatType)
    .parse(
      bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? bytes.buffer
        : bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ),
    );
}
if (map.width !== 16384 || map.height !== 8192)
  throw new Error(
    `Expected 16384 × 8192, received ${map.width} × ${map.height}`,
  );
if (map.data.length !== map.width * map.height * (ppm ? 3 : 4))
  throw new Error(
    'The source image has an incomplete or unexpected channel buffer',
  );

// Normalize the 16k raster to the previous 4k layer's exposure (16× linear).
// PPM input has already received that gain, before its RGB16 quantization.
// The lookup avoids repeated exponentiation for 400 million channels.
const linear = new Float32Array(65536);
const encoded = new Uint8Array(65536);
const srgb = (v) =>
  Math.round(
    255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055),
  );
for (let i = 0; i < 65536; i++) {
  linear[i] = ppm
    ? i / 65535
    : Math.max(0, Math.min(1, DataUtils.fromHalfFloat(i) * 16));
  encoded[i] = srgb(linear[i]);
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++)
    crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc;
});
function chunk(type, data) {
  const tag = Buffer.from(type);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([tag, data])) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  }
  const header = Buffer.alloc(4),
    footer = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  footer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([header, tag, data, footer]);
}
function jpeg(name, width, height, scan) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const temporary = path.join(scratch, 'sky-tile.png');
  fs.writeFileSync(
    temporary,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header),
      chunk('sRGB', Buffer.from([0])),
      chunk('IDAT', deflateSync(scan, { level: 1 })),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
  execFileSync(
    'sips',
    [
      '-s',
      'format',
      'jpeg',
      '-s',
      'formatOptions',
      '94',
      temporary,
      '--out',
      path.join(output, name),
    ],
    { stdio: 'ignore' },
  );
}
const tileSize = 1024,
  gutter = 4,
  extent = tileSize + gutter * 2;
// Longitude wraps; latitude clamps. EXRLoader stores its rows bottom-up.
function sample(x, y) {
  const sx = (x + map.width) % map.width;
  const sy = Math.max(0, Math.min(map.height - 1, y));
  return ((ppm ? sy : map.height - 1 - sy) * map.width + sx) * (ppm ? 3 : 4);
}
const columnsPerRow = [4, 8, 16, 16, 16, 16, 8, 4];
const rows = selectedRows
  ? selectedRows.split(',').map(Number)
  : columnsPerRow.map((_, row) => row);
for (const row of rows) {
  if (!Number.isInteger(row) || row < 0 || row > 7)
    throw new Error('Invalid sky row');
  const stride = 16 / columnsPerRow[row];
  for (let column = 0; column < columnsPerRow[row]; column++) {
    const scan = Buffer.alloc((extent * 3 + 1) * extent);
    for (let y = 0; y < extent; y++) {
      for (let x = 0; x < extent; x++) {
        const target = y * (extent * 3 + 1) + 1 + x * 3;
        const sx = (column * tileSize + x - gutter) * stride;
        const sy = row * tileSize + y - gutter;
        if (stride === 1) {
          const input = sample(sx, sy);
          for (let c = 0; c < 3; c++)
            scan[target + c] = encoded[map.data[input + c]];
        } else {
          // Longitude converges near the poles. Average that oversampling in
          // linear light, preserving full native resolution in latitude.
          const sum = [0, 0, 0];
          for (let dx = 0; dx < stride; dx++) {
            const input = sample(sx + dx, sy);
            for (let c = 0; c < 3; c++) sum[c] += linear[map.data[input + c]];
          }
          for (let c = 0; c < 3; c++) scan[target + c] = srgb(sum[c] / stride);
        }
      }
    }
    jpeg(`${row}-${column}.jpg`, extent, extent, scan);
  }
  for (let column = columnsPerRow[row]; column < 16; column++) {
    const obsolete = path.join(output, `${row}-${column}.jpg`);
    if (fs.existsSync(obsolete)) fs.unlinkSync(obsolete);
  }
  console.log(`Encoded sky row ${row + 1}/8`);
}
// A small continuous fallback covers the entire sphere while detail streams in.
// Average in linear light, before sRGB encoding, to match the source exposure.
if (!selectedRows) {
  const width = 2048,
    height = 1024,
    base = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sum = [0, 0, 0];
      for (let dy = 0; dy < 8; dy++) {
        for (let dx = 0; dx < 8; dx++) {
          const input = sample(x * 8 + dx, y * 8 + dy);
          for (let c = 0; c < 3; c++) sum[c] += linear[map.data[input + c]];
        }
      }
      const target = y * (width * 3 + 1) + 1 + x * 3;
      for (let c = 0; c < 3; c++) base[target + c] = srgb(sum[c] / 64);
    }
  }
  jpeg('base.jpg', width, height, base);
}
fs.writeFileSync(
  path.join(output, 'manifest.json'),
  JSON.stringify(
    {
      version: 2,
      width: map.width,
      height: map.height,
      tileSize,
      gutter,
      columnsPerRow,
      rows: 8,
      encoding: 'sRGB JPEG quality 94',
      linearExposureGain: 16,
      source:
        'https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/milkyway_2020_16k.exr',
    },
    null,
    2,
  ) + '\n',
);
console.log(
  selectedRows
    ? 'Updated selected rows.'
    : 'Encoded 88 sky tiles and the 2048 × 1024 fallback.',
);
