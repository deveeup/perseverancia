// Distancia Tierra–Marte y tiempo de luz, calculados en vivo (sin librerías ni red).
// Método: posiciones aproximadas de los planetas con elementos keplerianos (E. M. Standish, JPL,
// "Keplerian Elements for Approximate Positions of the Major Planets", tabla válida 1800–2050).
// Es una aproximación: sirve para minutos con ~1 % de error, no para navegar una nave.

const AU_KM = 149597870.7;
const C_KM_S = 299792.458;
const JD_UNIX_EPOCH = 2440587.5;
const JD_J2000 = 2451545.0;

// [valor en J2000, variación por siglo juliano]
const ELEMENTS = {
  earth: { // baricentro Tierra–Luna
    a: [1.00000261, 0.00000562], e: [0.01671123, -0.00004392], I: [-0.00001531, -0.01294668],
    L: [100.46457166, 35999.37244981], varpi: [102.93768193, 0.32327364], Om: [0.0, 0.0],
  },
  mars: {
    a: [1.52371034, 0.00001847], e: [0.0933941, 0.00007882], I: [1.84969142, -0.00813131],
    L: [-4.55343205, 19140.30268499], varpi: [-23.94362959, 0.44441088], Om: [49.55953891, -0.29257343],
  },
};

const rad = (d) => (d * Math.PI) / 180;

/** Posición heliocéntrica (UA, plano de la eclíptica J2000) en T siglos desde J2000. */
function heliocentric(el, T) {
  const at = (p) => p[0] + p[1] * T;
  const a = at(el.a), e = at(el.e), I = rad(at(el.I));
  const varpi = at(el.varpi), Om = at(el.Om);
  const omega = rad(varpi - Om);
  const M = rad((((at(el.L) - varpi) % 360) + 540) % 360 - 180); // anomalía media en [-180°, 180°]
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E)); // ecuación de Kepler
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(omega), sw = Math.sin(omega);
  const cO = Math.cos(rad(Om)), sO = Math.sin(rad(Om));
  const cI = Math.cos(I), sI = Math.sin(I);
  return [
    (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    sw * sI * xp + cw * sI * yp,
  ];
}

/** Distancia Tierra–Marte en km en el instante `ms` (milisegundos Unix). */
export function earthMarsDistanceKm(ms) {
  const T = (ms / 86400000 + JD_UNIX_EPOCH - JD_J2000) / 36525;
  const e = heliocentric(ELEMENTS.earth, T);
  const m = heliocentric(ELEMENTS.mars, T);
  return Math.hypot(m[0] - e[0], m[1] - e[1], m[2] - e[2]) * AU_KM;
}

/** Segundos que tarda una señal de radio en ir de Marte a la Tierra. */
export const lightTimeSeconds = (ms) => earthMarsDistanceKm(ms) / C_KM_S;
