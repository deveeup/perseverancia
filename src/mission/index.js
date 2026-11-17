import './panel.css';
import { Telemetry } from './telemetry.js';
import { nasaDrivesProvider, lightTimeProvider } from './providers.js';
import { createPanel } from './panel.js';

const n = (digits) => (v) => new Intl.NumberFormat('es', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);

// Los 4 datos del control de misión. Nombre, unidad y proveedor vienen de la metadata de cada proveedor;
// aquí solo va lo que es del juego: color, decimales y la frase que explica qué significa el número.
const CARDS = [
  {
    key: 'distance', color: '#f2b27a', digits: 2, axisDigits: 0,
    phrase: (d) => `Lo que Percy ha rodado desde que aterrizó: ${n(1)(d.value / 42.195)} maratones.`,
  },
  {
    key: 'elevation', color: '#e8814f', digits: 0, axisDigits: 0,
    phrase: (d) => d.value < 0
      ? `Se mide desde el nivel de referencia de Marte. Percy va ${n(0)(-d.value)} m más abajo: Jezero es un cráter.`
      : `Se mide desde el nivel de referencia de Marte. Percy va ${n(0)(d.value)} m más arriba.`,
  },
  {
    key: 'tilt', color: '#f0d078', digits: 1, axisDigits: 0,
    phrase: (d) => `Inclinación al terminar su último manejo. 0° es suelo plano; ${n(1)(d.value)}° es ${d.value < 4 ? 'casi plano' : d.value < 12 ? 'una cuesta suave' : 'una cuesta marcada'}.`,
  },
  {
    key: 'lightTime', color: '#8ec9e6', digits: 2, axisDigits: 0, live: true,
    phrase: (d) => `Una señal de radio tarda ${n(1)(d.value)} min de Marte a la Tierra. Ida y vuelta: ${n(1)(d.value * 2)} min.`,
  },
];

export function initMissionControl() {
  const telemetry = new Telemetry();
  telemetry.addProvider(nasaDrivesProvider(`${import.meta.env.BASE_URL}data/m20_drives.json`));
  telemetry.addProvider(lightTimeProvider());
  return createPanel({ telemetry, cards: CARDS });
}
