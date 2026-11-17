import { drawChart } from './chart.js';
import { LANDING_MS, SOL_MS } from './providers.js';

const nf = (digits) => new Intl.NumberFormat('es', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const fmtDate = (ms) => new Date(ms).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).replace('.', '');

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/**
 * Panel de control de misión dentro del juego. Cada tarjeta pide a `telemetry` el nombre, la unidad y el
 * proveedor del dato (metadata), su historia completa (request) y su valor actual (subscribe).
 * cards: [{ key, color, digits, axisDigits, live?, phrase(latest, series) }]
 */
export function createPanel({ telemetry, cards }) {
  const root = el('aside');
  root.id = 'mission';
  root.setAttribute('aria-label', 'Control de misión');

  const clock = el('span', 'mc-clock');
  const head = el('div', 'mc-head');
  head.append(el('b', '', 'CONTROL DE MISIÓN'), clock);
  root.append(head);

  const tick = () => {
    const now = Date.now();
    clock.textContent = `SOL ${Math.floor((now - LANDING_MS) / SOL_MS)} · ${new Date(now).toISOString().slice(11, 19)} UTC`;
  };
  tick();
  setInterval(tick, 1000);

  const end = Date.now();
  const state = cards.map((cfg) => {
    const card = el('article', 'mc-card');
    card.style.setProperty('--c', cfg.color);
    const name = el('span', 'mc-name', cfg.key), prov = el('span', 'mc-prov');
    const top = el('div', 'mc-top'); top.append(name, prov);
    const num = el('span', 'mc-num', '…'), unit = el('span', 'mc-unit'), fresh = el('span', 'mc-fresh');
    const val = el('div', 'mc-val'); val.append(num, unit, fresh);
    const canvas = el('canvas', 'mc-chart');
    const phrase = el('p', 'mc-phrase', 'Cargando…');
    card.append(top, val, canvas, phrase);
    root.append(card);
    return { cfg, key: cfg.key, card, nodes: { name, prov, num, unit, fresh, canvas, phrase }, ok: false, error: null,
      name: '', unit: '', provider: '', value: null, display: '', points: 0, phrase: '', fresh: '', series: [], latest: null };
  });
  const hint = el('div', 'mc-key');
  hint.innerHTML = '<kbd>T</kbd> ocultar / mostrar';
  root.append(hint);
  document.body.appendChild(root);

  const redraw = (c) => c.series.length && drawChart(c.nodes.canvas, c.series, { start: LANDING_MS, end, color: c.cfg.color, axisDigits: c.cfg.axisDigits });

  function render(c) {
    const d = c.latest;
    if (!d) return;
    c.value = d.value;
    c.display = nf(c.cfg.digits).format(d.value);
    c.phrase = c.cfg.phrase(d, c.series);
    c.fresh = c.cfg.live ? '● en vivo' : `sol ${d.sol} · ${fmtDate(d.utc)}`;
    c.nodes.num.textContent = c.display;
    c.nodes.phrase.textContent = c.phrase;
    c.nodes.fresh.textContent = c.fresh;
    c.nodes.fresh.classList.toggle('live', !!c.cfg.live);
    c.ok = Number.isFinite(d.value) && c.series.length >= 10;
    redraw(c);
  }

  state.forEach(async (c) => {
    try {
      const meta = telemetry.metadata(c.key);
      c.name = meta.name; c.unit = meta.unit; c.provider = meta.provider;
      c.nodes.name.textContent = meta.name;
      c.nodes.unit.textContent = meta.unit;
      c.nodes.prov.textContent = meta.provider;
      c.nodes.prov.title = meta.provider;
      c.series = await telemetry.request(c.key, { start: LANDING_MS, end });
      c.points = c.series.length;
      telemetry.subscribe(c.key, (d) => { c.latest = d; render(c); });
    } catch (e) {
      c.error = String(e?.message ?? e);
      c.card.classList.add('error');
      c.nodes.num.textContent = 'sin datos';
      c.nodes.phrase.textContent = c.error;
    }
  });

  // --- tecla T: ocultar / mostrar ---
  const setVisible = (v) => {
    root.hidden = !v;
    if (v) state.forEach(redraw);
  };
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyT' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) setVisible(root.hidden);
  });

  // estado legible para `npm run check`
  window.__mission = {
    snapshot: () => ({
      ready: state.every((c) => c.ok || c.error),
      visible: !root.hidden,
      cards: state.map(({ key, ok, error, name, unit, provider, value, display, points, phrase, fresh }) =>
        ({ key, ok, error, name, unit, provider, value, display, points, phrase, fresh })),
    }),
  };
  return { setVisible };
}
