import { lightTimeSeconds, earthMarsDistanceKm } from './ephemeris.js';

export const LANDING_MS = Date.parse('2021-02-18T20:55:00Z'); // aterrizaje de Perseverance (sol 0)
export const SOL_MS = 88775.244 * 1000; // duración de un sol marciano

/** Un sol (día marciano de la misión) → instante UTC aproximado. */
export const solToMs = (sol) => LANDING_MS + sol * SOL_MS;

// Valores que describe cada dato, como `telemetry.values` en Open MCT (API.md:496-521):
// una hora con pista `domain` y una medida con pista `range`.
const valuesFor = (name, unit) => [
  { key: 'utc', name: 'Hora', format: 'utc', hints: { domain: 1 } },
  { key: 'value', name, unit, hints: { range: 1 } },
];

// ---------------------------------------------------------------------------------------------------
// Proveedor 1: historial de manejos de la NASA (3 datos). Lee la copia local public/data/m20_drives.json,
// que genera `npm run data` a partir de M20_waypoints.json de la NASA. Un renglón por fin de manejo.
// ---------------------------------------------------------------------------------------------------
const NASA_PROVIDER = 'NASA · M20 waypoints'; // historial de manejos de Perseverance

const NASA_VALUES = {
  distance: { name: 'Distancia recorrida', unit: 'km', field: 'dist_total_m', scale: 1 / 1000 },
  elevation: { name: 'Altura del terreno', unit: 'm', field: 'elev_geoid', scale: 1 },
  tilt: { name: 'Inclinación', unit: '°', field: 'tilt', scale: 1 },
};

export function nasaDrivesProvider(url) {
  let doc = null;
  const load = () =>
    (doc ??= fetch(url).then((r) => {
      if (!r.ok) throw new Error(`No se pudo leer ${url} (${r.status})`);
      return r.json();
    }));
  const series = async (key, { start = -Infinity, end = Infinity } = {}) => {
    const { field, scale } = NASA_VALUES[key];
    return (await load()).rows
      .map((r) => ({ utc: solToMs(r.sol), value: r[field] * scale, sol: r.sol }))
      .filter((d) => d.utc >= start && d.utc <= end);
  };
  const has = (key) => key in NASA_VALUES;

  return {
    supportsMetadata: has,
    getMetadata: (key) => ({
      key,
      name: NASA_VALUES[key].name,
      unit: NASA_VALUES[key].unit,
      provider: NASA_PROVIDER,
      values: valuesFor(NASA_VALUES[key].name, NASA_VALUES[key].unit),
    }),
    supportsRequest: has,
    request: series,
    // Son datos históricos: "en vivo" es la última lectura conocida.
    supportsSubscribe: has,
    subscribe: (key, callback) => {
      let active = true;
      series(key).then((all) => active && all.length && callback(all.at(-1)));
      return () => { active = false; };
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// Proveedor 2: tiempo de luz Tierra–Marte, calculado aquí con las efemérides de ephemeris.js.
// ---------------------------------------------------------------------------------------------------
const LIGHT_PROVIDER = 'Efemérides (cálculo propio)';

export function lightTimeProvider() {
  const has = (key) => key === 'lightTime';
  const datum = (ms) => ({ utc: ms, value: lightTimeSeconds(ms) / 60, distanceKm: earthMarsDistanceKm(ms) });
  return {
    supportsMetadata: has,
    getMetadata: (key) => ({ key, name: 'Luz Tierra ↔ Marte', unit: 'min', provider: LIGHT_PROVIDER, values: valuesFor('Tiempo de luz', 'min') }),
    supportsRequest: has,
    // una muestra por día (o cada `step` ms) desde `start` hasta `end`
    request: async (key, { start = LANDING_MS, end = Date.now(), step = 86400000 } = {}) => {
      const out = [];
      for (let t = start; t <= end; t += step) out.push(datum(t));
      return out;
    },
    supportsSubscribe: has,
    subscribe: (key, callback) => {
      const tick = () => callback(datum(Date.now()));
      tick();
      const id = setInterval(tick, 1000);
      return () => clearInterval(id);
    },
  };
}
