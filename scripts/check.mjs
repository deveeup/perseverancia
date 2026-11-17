import { chromium } from 'playwright-core';
import { mkdirSync, existsSync } from 'node:fs';

const URL = process.env.CHECK_URL || 'http://localhost:5173/?check';
const CHROME =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = process.env.CHECK_OUT || 'screenshots/check.png';

if (!existsSync(CHROME)) {
  console.error(`✗ No encuentro Chrome en: ${CHROME} (usa CHROME_PATH=...)`);
  process.exit(2);
}
try {
  await fetch(URL.split('?')[0]);
} catch {
  console.error(`✗ El servidor no responde en ${URL}. Arráncalo con: npm run dev`);
  process.exit(2);
}

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

const errors = [];
const roverLogs = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  else if (m.text().startsWith('[rover]')) roverLogs.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} (${r.failure()?.errorText})`));

await page.goto(URL, { waitUntil: 'load' });
try {
  await page.waitForFunction('window.__ready === true', null, { timeout: 90000 });
} catch {
  errors.push('timeout: window.__ready nunca fue true (¿WebGL falló o la escena no cargó?)');
}
await page.waitForTimeout(1000);

// --- prueba de conducción con teclado real: W durante 2.5 s ---
const before = await page.evaluate(() => window.__state?.());
// Chrome sin GPU renderiza lento, así que se mantiene W hasta ver avance real (máx. 60 s) en vez de un tiempo fijo
await page.keyboard.down('KeyW');
await page
  .waitForFunction((d0) => window.__state().distance - d0 > 4, before?.distance ?? 0, { timeout: 60000, polling: 250 })
  .catch(() => {});
await page.keyboard.up('KeyW');
// dejar que frene y que la cámara se asiente antes de la captura
await page.waitForFunction('window.__state().speed === 0', null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(2500);
const after = await page.evaluate(() => window.__state?.());

mkdirSync('screenshots', { recursive: true });
await page.screenshot({ path: OUT });
const info = await page.evaluate(() => window.__info ?? null);
const debug = await page.evaluate(() => window.__roverDebug ?? null);
await browser.close();

console.log(`✓ Captura: ${OUT}`);
console.log('Info:', JSON.stringify({ ...info, cameraParts: undefined }));
console.log('Debug rover:', JSON.stringify(debug));
console.log('Antes de W:', JSON.stringify(before));
console.log('Tras W:    ', JSON.stringify(after));
roverLogs.forEach((l) => console.log(l));

// --- comprobaciones ---
const checks = [
  ['rover cargado', info?.roverLoaded === true],
  ['sol y lunas en cuadro', info?.sunInView && info?.phobosInView && info?.deimosInView],
  ['rover en cuadro', info?.roverInView === true],
  ['6 ruedas separadas', info?.wheelsSpinning === 6],
  ['W mueve el rover', after && before && after.distance - before.distance > 0.5],
  ['las ruedas giran', after?.wheelRotation?.some((r, i) => Math.abs(r - (before?.wheelRotation?.[i] ?? 0)) > 0.1)],
  ['hay huellas', (after?.tracks ?? 0) > 20],
];
let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) failed = true;
}
if (errors.length) {
  console.error(`✗ ${errors.length} error(es):`);
  errors.forEach((e) => console.error('  - ' + e));
  failed = true;
} else console.log('✓ Sin errores de consola');
process.exit(failed ? 1 : 0);
