#!/usr/bin/env node
/**
 * Regenerates ChatAI A1 favicon/PNG derivatives from canonical SVGs.
 * Source of truth: public/icon.svg (full) + public/icon-16.svg (optical 16).
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(webRoot, "../..");
const require = createRequire(path.join(repoRoot, "package.json"));
const sharp = require(
  path.join(repoRoot, "node_modules/.pnpm/sharp@0.34.5/node_modules/sharp"),
);

const FULL_SVG = path.join(webRoot, "public/icon.svg");
const OPTICAL_16_SVG = path.join(webRoot, "public/icon-16.svg");
const APPLE_OUT = path.join(webRoot, "public/apple-touch-icon.png");
const FAVICON_OUT = path.join(webRoot, "src/app/favicon.ico");

/** Minimal ICO writer for square PNGs (16/32/…). */
function pngsToIco(pngBuffers) {
  const count = pngBuffers.length;
  const headerSize = 6 + count * 16;
  let offset = headerSize;
  const entries = [];
  for (const png of pngBuffers) {
    // IHDR width/height at bytes 16–23 (big-endian)
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    const wByte = width >= 256 ? 0 : width;
    const hByte = height >= 256 ? 0 : height;
    entries.push({ wByte, hByte, size: png.length, offset, png });
    offset += png.length;
  }
  const out = Buffer.alloc(offset);
  out.writeUInt16LE(0, 0);
  out.writeUInt16LE(1, 2);
  out.writeUInt16LE(count, 4);
  let entryAt = 6;
  for (const e of entries) {
    out.writeUInt8(e.wByte, entryAt);
    out.writeUInt8(e.hByte, entryAt + 1);
    out.writeUInt8(0, entryAt + 2);
    out.writeUInt8(0, entryAt + 3);
    out.writeUInt16LE(1, entryAt + 4);
    out.writeUInt16LE(32, entryAt + 6);
    out.writeUInt32LE(e.size, entryAt + 8);
    out.writeUInt32LE(e.offset, entryAt + 12);
    e.png.copy(out, e.offset);
    entryAt += 16;
  }
  return out;
}

async function raster(svgPath, size) {
  const svg = fs.readFileSync(svgPath);
  return sharp(svg, { density: 384 })
    .resize(size, size, { fit: "contain", background: { r: 5, g: 6, b: 12, alpha: 1 } })
    .png()
    .toBuffer();
}

async function main() {
  if (!fs.existsSync(FULL_SVG) || !fs.existsSync(OPTICAL_16_SVG)) {
    throw new Error("Missing public/icon.svg or public/icon-16.svg");
  }

  const png16 = await raster(OPTICAL_16_SVG, 16);
  const png32 = await raster(FULL_SVG, 32);
  const png180 = await raster(FULL_SVG, 180);

  fs.writeFileSync(APPLE_OUT, png180);
  fs.writeFileSync(FAVICON_OUT, pngsToIco([png16, png32]));

  console.log("Wrote", path.relative(webRoot, APPLE_OUT), "(180×180)");
  console.log("Wrote", path.relative(webRoot, FAVICON_OUT), "(16 + 32 ICO)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
