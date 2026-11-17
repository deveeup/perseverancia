// Uso: npm run data
// Descarga el historial de manejos de Perseverance (NASA/JPL, MMGIS) y guarda solo lo que usa el control
// de misión: un renglón por FIN DE MANEJO con sol, posición, distancia acumulada, altura e inclinación.
// Se deja fuera lo demás (en especial `images`, que es del acto 3).
import { mkdirSync, writeFileSync } from 'node:fs';

const SOURCE = process.argv[2] || 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json';
const OUT = 'public/data/m20_drives.json';

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`NASA respondió ${res.status} para ${SOURCE}`);
const doc = await res.json();
if (doc.type !== 'FeatureCollection' || !Array.isArray(doc.features)) throw new Error('El archivo no es un FeatureCollection');

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
// final === 'y' = "End-of-drive localization". Las filas 'm' (a mitad de manejo) e 'i' (interpoladas) traen distancia 0.
const rows = doc.features
  .map((f) => f.properties)
  .filter((p) => p.final === 'y')
  .map((p) => ({
    sol: p.sol,
    lat: round(p.lat, 6),
    lon: round(p.lon, 6),
    dist_total_m: round(p.dist_total_m, 3),
    elev_geoid: round(p.elev_geoid, 2),
    tilt: round(p.tilt, 2),
  }));

// validaciones: si la NASA cambia el formato, esto falla en voz alta en vez de guardar datos raros
for (const [i, r] of rows.entries()) {
  for (const k of ['sol', 'lat', 'lon', 'dist_total_m', 'elev_geoid', 'tilt'])
    if (!Number.isFinite(r[k])) throw new Error(`fila ${i}: ${k} no es un número (${r[k]})`);
  if (i > 0 && r.sol < rows[i - 1].sol) throw new Error(`fila ${i}: el sol retrocede`);
  if (i > 0 && r.dist_total_m < rows[i - 1].dist_total_m) throw new Error(`fila ${i}: la distancia acumulada baja`);
}
if (rows.length < 100) throw new Error(`solo ${rows.length} filas: algo cambió en el archivo`);

mkdirSync('public/data', { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify({
    source: SOURCE,
    dataset: doc.name,
    lastModified: res.headers.get('last-modified'),
    fetchedAt: new Date().toISOString(),
    note: 'Una fila por fin de manejo (final="y"). dist_total_m = distancia acumulada en metros; elev_geoid = altura sobre el geoide de Marte en metros; tilt = inclinación en grados.',
    landingUtc: '2021-02-18T20:55:00Z',
    solSeconds: 88775.244,
    rows,
  }),
);
const last = rows.at(-1);
console.log(`✓ ${OUT}: ${rows.length} manejos, sol ${rows[0].sol} → ${last.sol}`);
console.log(`  último: ${(last.dist_total_m / 1000).toFixed(2)} km · ${last.elev_geoid} m · ${last.tilt}°  (archivo NASA: ${res.headers.get('last-modified')})`);
