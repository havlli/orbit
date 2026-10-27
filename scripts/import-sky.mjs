/** Rebuild the local sky from downloaded primary-source inputs. See public/sky/SOURCES.md.
 * node scripts/import-sky.mjs catalog.gz milkyway_2020_4k.exr output.png
 * Then encode the PNG as JPEG with sips (command in SOURCES.md). */
import fs from 'node:fs';
import { gunzipSync, deflateSync } from 'node:zlib';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { FloatType } from 'three';

const [catalogPath, milkyWayPath, imagePath] = process.argv.slice(2);
if (!catalogPath || !milkyWayPath || !imagePath)
  throw new Error('Expected catalog.gz, milkyway_2020_4k.exr, output.png');
const rows = gunzipSync(fs.readFileSync(catalogPath))
  .toString('ascii')
  .split('\n');
const stars = rows
  .filter((row) => row.slice(75, 77).trim())
  .map((row) => {
    const number = (start, end) => Number(row.slice(start - 1, end));
    const ra =
      15 * (number(76, 77) + number(78, 79) / 60 + number(80, 83) / 3600);
    const dec =
      (row[83] === '-' ? -1 : 1) *
      (number(85, 86) + number(87, 88) / 60 + number(89, 90) / 3600);
    return [
      number(1, 4),
      +ra.toFixed(6),
      +dec.toFixed(6),
      number(103, 107),
      row.slice(109, 114).trim() ? number(110, 114) : null,
    ];
  });
if (stars.length !== 9096)
  throw new Error(`Unexpected catalog coverage: ${stars.length}`);
fs.mkdirSync('public/sky', { recursive: true });
fs.writeFileSync(
  'public/sky/bright-stars.json',
  JSON.stringify({
    version: 1,
    frame: 'J2000',
    source: 'https://cdsarc.cds.unistra.fr/viz-bin/cat/V/50',
    columns: ['HR', 'RAdeg', 'DEdeg', 'Vmag', 'B-V'],
    stars,
  }) + '\n',
);

const bytes = fs.readFileSync(milkyWayPath);
const map = new EXRLoader()
  .setDataType(FloatType)
  .parse(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
// Store linear source radiance in an sRGB image, without auto-levels or new detail.
// EXRLoader returns bottom-up rows; PNG scanlines are top-down.
const srgb = (value) =>
  Math.round(
    255 *
      (value <= 0.0031308
        ? 12.92 * value
        : 1.055 * Math.pow(value, 1 / 2.4) - 0.055),
  );
const scan = Buffer.alloc((map.width * 3 + 1) * map.height);
for (let y = 0; y < map.height; y++) {
  for (let x = 0; x < map.width; x++) {
    const input = ((map.height - 1 - y) * map.width + x) * 4;
    const output = y * (map.width * 3 + 1) + 1 + x * 3;
    for (let c = 0; c < 3; c++)
      scan[output + c] = srgb(Math.min(1, Math.max(0, map.data[input + c])));
  }
}
// Minimal lossless PNG writer: no imaging dependency required for ingestion.
function chunk(type, data) {
  const tag = Buffer.from(type);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([tag, data])) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  const footer = Buffer.alloc(4);
  footer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([header, tag, data, footer]);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(map.width);
header.writeUInt32BE(map.height, 4);
header[8] = 8;
header[9] = 2;
fs.writeFileSync(
  imagePath,
  Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('sRGB', Buffer.from([0])),
    chunk('IDAT', deflateSync(scan)),
    chunk('IEND', Buffer.alloc(0)),
  ]),
);
console.log(
  `Imported ${stars.length} stars and ${map.width} × ${map.height} Milky Way.`,
);
