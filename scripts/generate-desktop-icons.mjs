import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const root = process.cwd();
const assets = path.join(root, 'apps', 'desktop', 'assets');
const svg = path.join(assets, 'icon.svg');
const png = path.join(assets, 'icon.png');
const ico = path.join(assets, 'icon.ico');

await sharp(svg).resize(512, 512).png().toFile(png);
await fs.writeFile(ico, await pngToIco(png));
