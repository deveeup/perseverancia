/** Gráfica de línea con área para toda la misión (canvas 2D, sin librerías). */
export function drawChart(canvas, series, { start, end, color, axisDigits = 0 }) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return; // oculto: se vuelve a dibujar al mostrarse
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (series.length < 2) return;

  const L = 38, R = 4, T = 4, B = 12; // márgenes: etiquetas del eje Y a la izquierda, años abajo
  let lo = Infinity, hi = -Infinity;
  for (const d of series) { lo = Math.min(lo, d.value); hi = Math.max(hi, d.value); }
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const x = (t) => L + ((t - start) / (end - start)) * (w - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (h - T - B);
  const axis = (v) => v.toLocaleString('es', { minimumFractionDigits: axisDigits, maximumFractionDigits: axisDigits });

  ctx.font = '9px ui-monospace, Menlo, monospace';
  ctx.textBaseline = 'middle';

  // rejilla mínima: mínimo y máximo reales de la serie
  ctx.strokeStyle = 'rgba(246,220,192,0.14)';
  ctx.lineWidth = 1;
  ctx.fillStyle = 'rgba(246,220,192,0.62)';
  ctx.textAlign = 'right';
  for (const v of [hi, lo]) {
    ctx.beginPath(); ctx.moveTo(L, Math.round(y(v)) + 0.5); ctx.lineTo(w - R, Math.round(y(v)) + 0.5); ctx.stroke();
    ctx.fillText(axis(v), L - 5, Math.min(Math.max(y(v), T + 4), h - B - 4));
  }

  // años en el eje X
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const y0 = new Date(start).getUTCFullYear();
  ctx.fillText(String(y0), L + 8, h - 1);
  for (let yr = y0 + 1; Date.UTC(yr, 0, 1) < end; yr++) {
    const tx = x(Date.UTC(yr, 0, 1));
    ctx.fillText(String(yr), tx, h - 1);
  }

  // área + línea
  const grad = ctx.createLinearGradient(0, T, 0, h - B);
  grad.addColorStop(0, `${color}59`);
  grad.addColorStop(1, `${color}00`);
  ctx.beginPath();
  series.forEach((d, i) => (i ? ctx.lineTo(x(d.utc), y(d.value)) : ctx.moveTo(x(d.utc), y(d.value))));
  const last = series.at(-1);
  ctx.lineTo(x(last.utc), h - B);
  ctx.lineTo(x(series[0].utc), h - B);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  series.forEach((d, i) => (i ? ctx.lineTo(x(d.utc), y(d.value)) : ctx.moveTo(x(d.utc), y(d.value))));
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // último dato: punto con halo
  ctx.beginPath(); ctx.arc(x(last.utc), y(last.value), 4.5, 0, Math.PI * 2); ctx.fillStyle = `${color}40`; ctx.fill();
  ctx.beginPath(); ctx.arc(x(last.utc), y(last.value), 2.4, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
}
