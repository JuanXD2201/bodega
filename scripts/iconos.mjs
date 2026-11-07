// Genera los iconos PNG de la aplicación (192, 512, maskable y apple-touch) desde SVG propios.
// Uso: node scripts/iconos.mjs   (necesita Chrome instalado, igual que las pruebas e2e)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { CHROME } from '../e2e/ayudas.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'icons');
mkdirSync(OUT, { recursive: true });

const BG = '#14130f';
const mark = `<path d="M6 8h12a5 5 0 0 1 2 9.6A5 5 0 0 1 18 26H6z" fill="#ffc400"/><path d="M11 12v3h6a1.5 1.5 0 0 0 0-3zm0 7v3h7a1.5 1.5 0 0 0 0-3z" fill="#14130f"/>`;
// «any»: esquinas redondeadas. «maskable»: fondo a sangre y contenido dentro de la zona segura (80 %).
const svgAny = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="3" fill="${BG}"/>${mark}</svg>`;
const svgMaskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="${BG}"/><g transform="translate(16 16) scale(0.78) translate(-16 -16)">${mark}</g></svg>`;
writeFileSync(join(ROOT, 'public', 'icon.svg'), svgAny + '\n');

const jobs = [
  ['icon-192.png', 192, svgAny],
  ['icon-512.png', 512, svgAny],
  ['maskable-512.png', 512, svgMaskable],
  ['apple-touch-icon.png', 180, svgMaskable],
];
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
for (const [name, size, svg] of jobs) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: join(OUT, name), omitBackground: true });
  await page.close();
  console.log('icono:', name);
}
await browser.close();
