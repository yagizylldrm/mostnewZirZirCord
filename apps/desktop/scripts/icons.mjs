// Renders the SVG logo to PNG icons for the desktop installers, tray and web app manifest.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const sharp = require('sharp');
const svg = readFileSync(new URL('../../web/public/logo.svg', import.meta.url));
const out = (rel) => fileURLToPath(new URL(rel, import.meta.url));
await sharp(svg, { density: 512 }).resize(1024, 1024).png().toFile(out('../build/icon.png'));
for (const size of [32, 192, 512]) await sharp(svg, { density: 512 }).resize(size, size).png().toFile(out(`../../web/public/icon-${size}.png`));
console.log('icons written');
