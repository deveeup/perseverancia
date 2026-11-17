import { chromium } from 'playwright-core';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { lightTimeSeconds } from '../src/mission/ephemeris.js';

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

// --- control de misión: los 4 datos, las gráficas y la tecla T ---
await page.waitForFunction('window.__mission?.snapshot().ready === true', null, { timeout: 30000 }).catch(() => {});
const mission = await page.evaluate(() => window.__mission?.snapshot() ?? null);
const chartPixels = await page.evaluate(() =>
  [...document.querySelectorAll('#mission .mc-chart')].map((c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  }),
);
const panelState = () => page.evaluate(() => ({
  flag: window.__mission.snapshot().visible,
  display: getComputedStyle(document.getElementById('mission')).display,
}));
mkdirSync('screenshots', { recursive: true });
const shownBefore = await panelState();
await page.keyboard.press('KeyT'); // T oculta
await page.waitForTimeout(400);
const afterT1 = await panelState();
await page.screenshot({ path: OUT.replace(/\.png$/, '-hidden.png') });
await page.keyboard.press('KeyT'); // T vuelve a mostrar
await page.waitForTimeout(800);
const afterT2 = await panelState();
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

// --- datos de referencia para comparar con lo que muestra la página ---
const drives = JSON.parse(readFileSync('public/data/m20_drives.json', 'utf8'));
const lastDrive = drives.rows.at(-1);
const expected = {
  distance: lastDrive.dist_total_m / 1000,
  elevation: lastDrive.elev_geoid,
  tilt: lastDrive.tilt,
};
const card = (key) => mission?.cards.find((c) => c.key === key);
const lightNowMin = lightTimeSeconds(Date.now()) / 60;
const landingMin = lightTimeSeconds(Date.parse('2021-02-18T20:55:00Z')) / 60; // la NASA reportó 11 min 22 s = 11.37 min
const complete = (c) => c && c.ok && c.name && c.unit && c.provider && c.display && c.phrase && c.points >= 10 && !/NaN|undefined/.test(c.display + c.phrase);

console.log('\nControl de misión:');
for (const c of mission?.cards ?? [])
  console.log(`  ${c.ok ? '✓' : '✗'} ${(c.name || c.key).padEnd(22)} ${String(c.display).padStart(9)} ${c.unit.padEnd(4)} · ${c.provider} · ${c.points} puntos · ${c.fresh}\n      “${c.phrase}”${c.error ? '  ERROR: ' + c.error : ''}`);
console.log(`  luz ahora (cálculo del check): ${lightNowMin.toFixed(2)} min · al aterrizar: ${landingMin.toFixed(2)} min (NASA: 11.37)`);
console.log(`  píxeles dibujados por gráfica: ${chartPixels.join(', ')}`);
console.log(`  tecla T: antes ${JSON.stringify(shownBefore)} → T ${JSON.stringify(afterT1)} → T ${JSON.stringify(afterT2)}`);

// --- comprobaciones ---
const checks = [
  ['rover cargado', info?.roverLoaded === true],
  ['sol y lunas en cuadro', info?.sunInView && info?.phobosInView && info?.deimosInView],
  ['rover en cuadro', info?.roverInView === true],
  ['6 ruedas separadas', info?.wheelsSpinning === 6],
  ['W mueve el rover', after && before && after.distance - before.distance > 0.5],
  ['las ruedas giran', after?.wheelRotation?.some((r, i) => Math.abs(r - (before?.wheelRotation?.[i] ?? 0)) > 0.1)],
  ['hay huellas', (after?.tracks ?? 0) > 20],
  ['los 4 datos del control de misión cargaron (nombre, unidad, proveedor, valor, frase)', mission?.cards.length === 4 && mission.cards.every(complete)],
  ['distancia = último manejo de la NASA', Math.abs((card('distance')?.value ?? NaN) - expected.distance) < 1e-6],
  ['altura = último manejo de la NASA', Math.abs((card('elevation')?.value ?? NaN) - expected.elevation) < 1e-6],
  ['inclinación = último manejo de la NASA', Math.abs((card('tilt')?.value ?? NaN) - expected.tilt) < 1e-6],
  ['luz Tierra↔Marte en vivo y coincide con el cálculo', Math.abs((card('lightTime')?.value ?? NaN) - lightNowMin) < 0.2 && lightNowMin > 3 && lightNowMin < 23],
  ['el cálculo de luz acierta el aterrizaje (11.37 min ± 0.2)', Math.abs(landingMin - 11.37) < 0.2],
  ['las 4 gráficas dibujaron toda la misión', chartPixels.length === 4 && chartPixels.every((n) => n > 300)],
  ['panel visible al inicio', shownBefore.flag === true && shownBefore.display !== 'none'],
  ['T lo oculta', afterT1.flag === false && afterT1.display === 'none'],
  ['T lo vuelve a mostrar', afterT2.flag === true && afterT2.display !== 'none'],
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
