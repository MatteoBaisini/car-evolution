// ============================================================
// CHARTS.JS — Mini-libreria di grafici su canvas
// ============================================================
// Niente dipendenze: solo linee, rettangoli e testo.
// Non c'e' "learning" qui, e' solo visualizzazione.
// ============================================================

const CH = {
  grid: 'rgba(255,255,255,0.07)',
  axis: 'rgba(255,255,255,0.25)',
  text: '#9aa1b1',
  pad: { l: 44, r: 12, t: 26, b: 24 }
};

/**
 * Prepara un canvas per schermi ad alta densita' (retina):
 * disegniamo in "pixel logici" ma il canvas ne ha di piu'.
 */
function prepCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  if (!canvas.dataset.w) {
    canvas.dataset.w = canvas.width;
    canvas.dataset.h = canvas.height;
  }
  const w = +canvas.dataset.w, h = +canvas.dataset.h;
  if (canvas.width !== Math.round(w * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function emptyChart(ctx, w, h, text) {
  ctx.fillStyle = CH.text;
  ctx.font = '13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, w / 2, h / 2);
  ctx.textAlign = 'left';
}

function drawLegend(ctx, items, x, y) {
  ctx.font = '11px sans-serif';
  for (const it of items) {
    ctx.fillStyle = it.color;
    ctx.fillRect(x, y - 8, 10, 10);
    ctx.fillStyle = CH.text;
    ctx.fillText(it.label, x + 14, y + 1);
    x += 14 + ctx.measureText(it.label).width + 14;
  }
}

/** Griglia orizzontale + etichette asse Y. */
function drawYAxis(ctx, w, h, yMin, yMax, toY, fmt) {
  const { l, r } = CH.pad;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  for (let k = 0; k <= 4; k++) {
    const v = yMin + (k / 4) * (yMax - yMin);
    const y = toY(v);
    ctx.strokeStyle = CH.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(l, y);
    ctx.lineTo(w - r, y);
    ctx.stroke();
    ctx.fillStyle = CH.text;
    ctx.fillText(fmt(v), l - 6, y + 3);
  }
  ctx.textAlign = 'left';
}

/** Etichette asse X (numeri di generazione). */
function drawXAxis(ctx, h, n, toX, xStart) {
  ctx.font = '10px sans-serif';
  ctx.fillStyle = CH.text;
  ctx.textAlign = 'center';
  const ticks = Math.min(n, 6);
  const seen = new Set();
  for (let k = 0; k < ticks; k++) {
    const i = ticks === 1 ? 0 : Math.round((k / (ticks - 1)) * (n - 1));
    if (seen.has(i)) continue;
    seen.add(i);
    ctx.fillText(xStart + i, toX(i), h - 8);
  }
  ctx.textAlign = 'left';
}

/**
 * Grafico a linee.
 * opts = {
 *   series: [{ label, color, values: [numero|null], dash, width, step }],
 *   hLines: [{ y, label, color }],   linee orizzontali di riferimento
 *   yMin, yMax, fmt, xStart, empty
 * }
 */
function lineChart(canvas, opts) {
  const { ctx, w, h } = prepCanvas(canvas);
  const { l, r, t, b } = CH.pad;
  const n = Math.max(0, ...opts.series.map(s => s.values.length));
  const all = opts.series.flatMap(s => s.values).filter(v => v !== null && v !== undefined);
  if (n === 0 || all.length === 0) return emptyChart(ctx, w, h, opts.empty || 'In attesa della prima generazione…');

  const hl = opts.hLines || [];
  const yMin = opts.yMin ?? Math.min(...all);
  let yMax = opts.yMax ?? Math.max(...all, ...hl.map(x => x.y)) * 1.08;
  if (yMax <= yMin) yMax = yMin + 1;

  const plotW = w - l - r, plotH = h - t - b;
  const toX = i => l + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const toY = v => t + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
  const fmt = opts.fmt || (v => v.toFixed(1));

  drawYAxis(ctx, w, h, yMin, yMax, toY, fmt);
  drawXAxis(ctx, h, n, toX, opts.xStart ?? 1);

  for (const line of hl) {
    const y = toY(line.y);
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = line.color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(l, y);
    ctx.lineTo(w - r, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = line.color;
    ctx.font = '10px sans-serif';
    ctx.fillText(line.label, l + 4, y - 4);
  }

  for (const s of opts.series) {
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = s.width || 2;
    ctx.setLineDash(s.dash || []);
    ctx.beginPath();
    let drawing = false, prevY = null;
    s.values.forEach((v, i) => {
      if (v === null || v === undefined) { drawing = false; return; }
      const x = toX(i), y = toY(v);
      if (!drawing) ctx.moveTo(x, y);
      else if (s.step) { ctx.lineTo(x, prevY); ctx.lineTo(x, y); }
      else ctx.lineTo(x, y);
      drawing = true;
      prevY = y;
    });
    ctx.stroke();
    ctx.setLineDash([]);
    // Puntini se i dati sono pochi (o isolati da buchi)
    if (n <= 40 || s.dots) {
      s.values.forEach((v, i) => {
        if (v === null || v === undefined) return;
        ctx.beginPath();
        ctx.arc(toX(i), toY(v), 2.5, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }

  drawLegend(ctx, opts.series.map(s => ({ label: s.label, color: s.color })), l, 14);
}

/**
 * Barre impilate al 100%: ogni barra = una generazione.
 * opts = { rows: [[v1, v2, ...]], colors, labels, xStart, maxBars }
 */
function stackedBars(canvas, opts) {
  const { ctx, w, h } = prepCanvas(canvas);
  const { l, r, t, b } = CH.pad;
  const maxBars = opts.maxBars || 80;
  const rows = opts.rows.slice(-maxBars);
  if (rows.length === 0) return emptyChart(ctx, w, h, 'In attesa della prima generazione…');
  const xStart = (opts.xStart ?? 1) + (opts.rows.length - rows.length);

  const plotW = w - l - r, plotH = h - t - b;
  const toY = v => t + plotH - v * plotH;
  drawYAxis(ctx, w, h, 0, 1, toY, v => Math.round(v * 100) + '%');

  const bw = plotW / rows.length;
  rows.forEach((row, i) => {
    const total = row.reduce((s, v) => s + v, 0) || 1;
    let acc = 0;
    row.forEach((v, k) => {
      const y0 = toY(acc / total), y1 = toY((acc + v) / total);
      ctx.fillStyle = opts.colors[k];
      ctx.fillRect(l + i * bw + (bw > 4 ? 1 : 0), y1, Math.max(1, bw - (bw > 4 ? 2 : 0)), y0 - y1);
      acc += v;
    });
  });
  drawXAxis(ctx, h, rows.length, i => l + (i + 0.5) * bw, xStart);
  drawLegend(ctx, opts.labels.map((label, k) => ({ label, color: opts.colors[k] })), l, 14);
}

/**
 * Istogramma.
 * opts = { values, bins, xMax, markers: [{x, label, color}], colorOf(x) }
 */
function histogram(canvas, opts) {
  const { ctx, w, h } = prepCanvas(canvas);
  const { l, r, t, b } = CH.pad;
  if (!opts.values || opts.values.length === 0) return emptyChart(ctx, w, h, 'In attesa della prima generazione…');

  const bins = opts.bins || 20;
  const xMax = opts.xMax || Math.max(...opts.values) || 1;
  const counts = new Array(bins).fill(0);
  for (const v of opts.values) counts[Math.min(bins - 1, Math.floor((v / xMax) * bins))]++;
  const cMax = Math.max(...counts);

  const plotW = w - l - r, plotH = h - t - b;
  const toY = c => t + plotH - (c / cMax) * plotH;
  const toX = v => l + (v / xMax) * plotW;
  drawYAxis(ctx, w, h, 0, cMax, toY, v => Math.round(v));

  const bw = plotW / bins;
  counts.forEach((c, i) => {
    if (!c) return;
    ctx.fillStyle = opts.colorOf ? opts.colorOf((i + 0.5) * xMax / bins) : '#3498db';
    ctx.fillRect(l + i * bw + 1, toY(c), bw - 2, t + plotH - toY(c));
  });

  // Asse X: valori di fitness
  ctx.font = '10px sans-serif';
  ctx.fillStyle = CH.text;
  ctx.textAlign = 'center';
  for (let k = 0; k <= 4; k++) ctx.fillText((xMax * k / 4).toFixed(0), toX(xMax * k / 4), h - 8);
  ctx.textAlign = 'left';

  for (const m of opts.markers || []) {
    const x = toX(m.x);
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = m.color;
    ctx.beginPath();
    ctx.moveTo(x, t);
    ctx.lineTo(x, t + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = m.color;
    ctx.fillText(m.label, x + 4, t + 10);
  }

  if (opts.legend) drawLegend(ctx, opts.legend, l, 14);
}

/**
 * Grafico X-Y generico (telemetria, curve ingegneristiche).
 * opts = {
 *   series: [{ label, color, points: [[x, y], ...], width, dash, fill, dots }],
 *   xMin, xMax, yMin, yMax, fmtX, fmtY,
 *   xMarkers: [{ x, label, color }],   linee verticali (es. settori)
 *   hLines:   [{ y, label, color }],
 *   empty, breakOnXDrop                 (spezza la linea se x torna indietro)
 * }
 */
function xyChart(canvas, opts) {
  const { ctx, w, h } = prepCanvas(canvas);
  const { l, r, t, b } = CH.pad;
  const withData = opts.series.filter(s => s.points && s.points.length);
  if (!withData.length) return emptyChart(ctx, w, h, opts.empty || 'Nessun dato ancora');

  const xs = withData.flatMap(s => s.points.map(p => p[0]));
  const ys = withData.flatMap(s => s.points.map(p => p[1]));
  const xMin = opts.xMin ?? Math.min(...xs), xMax = opts.xMax ?? Math.max(...xs);
  const yMin = opts.yMin ?? Math.min(...ys);
  let yMax = opts.yMax ?? Math.max(...ys, ...(opts.hLines || []).map(x => x.y));
  if (opts.yMax === undefined) yMax = yMin + (yMax - yMin) * 1.08;
  if (yMax <= yMin) yMax = yMin + 1;

  const plotW = w - l - r, plotH = h - t - b;
  const toX = x => l + ((x - xMin) / (xMax - xMin || 1)) * plotW;
  const toY = y => t + plotH - ((clamp(y, yMin, yMax) - yMin) / (yMax - yMin)) * plotH;
  const fmtX = opts.fmtX || (v => v.toFixed(0));
  const fmtY = opts.fmtY || (v => v.toFixed(0));

  drawYAxis(ctx, w, h, yMin, yMax, toY, fmtY);
  ctx.font = '10px sans-serif';
  ctx.fillStyle = CH.text;
  ctx.textAlign = 'center';
  for (let k = 0; k <= 4; k++) {
    const x = xMin + (k / 4) * (xMax - xMin);
    ctx.fillText(fmtX(x), toX(x), h - 8);
  }
  ctx.textAlign = 'left';

  for (const m of opts.xMarkers || []) {
    ctx.strokeStyle = m.color || 'rgba(181,126,220,0.6)';
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(toX(m.x), t);
    ctx.lineTo(toX(m.x), t + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = m.color || '#b57edc';
    ctx.fillText(m.label, toX(m.x) + 3, t + 10);
  }
  for (const line of opts.hLines || []) {
    ctx.strokeStyle = line.color;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(l, toY(line.y));
    ctx.lineTo(w - r, toY(line.y));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = line.color;
    ctx.fillText(line.label, l + 4, toY(line.y) - 4);
  }

  for (const s of withData) {
    // spezzoni continui (si interrompe se x torna indietro)
    const runs = [[]];
    let prevX = -Infinity;
    for (const p of s.points) {
      if (opts.breakOnXDrop && p[0] < prevX - 0.05) runs.push([]);
      runs[runs.length - 1].push(p);
      prevX = p[0];
    }
    for (const run of runs) {
      if (run.length < 2) continue;
      if (s.fill) {
        ctx.beginPath();
        ctx.moveTo(toX(run[0][0]), toY(yMin));
        for (const p of run) ctx.lineTo(toX(p[0]), toY(p[1]));
        ctx.lineTo(toX(run[run.length - 1][0]), toY(yMin));
        ctx.closePath();
        ctx.fillStyle = s.fill;
        ctx.fill();
      }
      ctx.beginPath();
      run.forEach((p, i) => (i ? ctx.lineTo(toX(p[0]), toY(p[1])) : ctx.moveTo(toX(p[0]), toY(p[1]))));
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width || 1.6;
      ctx.setLineDash(s.dash || []);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (s.dots) {
      ctx.fillStyle = s.color;
      for (const p of s.points) {
        ctx.beginPath();
        ctx.arc(toX(p[0]), toY(p[1]), s.dotSize || 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  drawLegend(ctx, opts.series.filter(s => s.label).map(s => ({ label: s.label, color: s.color })), l, 14);
}

/**
 * Diagramma g-g (il "cerchio di aderenza" visto dai dati):
 * ogni punto e' un istante del giro. X = accelerazione laterale,
 * Y = longitudinale (su = accelera, giu' = frena).
 * Un pilota perfetto "riempie" il cerchio: usa tutto il grip, sempre.
 * opts = { groups: [{ label, color, points: [[gLat, gLong], ...] }], maxG, live: {x, y, limit} }
 */
function ggDiagram(canvas, opts) {
  const { ctx, w, h } = prepCanvas(canvas);
  const maxG = opts.maxG || 5;
  const size = Math.min(w, h) - (opts.compact ? 16 : 40);
  const cx = w / 2, cy = h / 2 + (opts.compact ? 0 : 6);
  const k = size / 2 / maxG;

  ctx.font = '10px sans-serif';
  for (let g = 1; g <= maxG; g++) {
    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    ctx.beginPath();
    ctx.arc(cx, cy, g * k, 0, Math.PI * 2);
    ctx.stroke();
    if (!opts.compact) {
      ctx.fillStyle = CH.text;
      ctx.fillText(g + 'g', cx + g * k * 0.707 + 2, cy - g * k * 0.707);
    }
  }
  ctx.strokeStyle = CH.axis;
  ctx.beginPath();
  ctx.moveTo(cx - size / 2, cy); ctx.lineTo(cx + size / 2, cy);
  ctx.moveTo(cx, cy - size / 2); ctx.lineTo(cx, cy + size / 2);
  ctx.stroke();
  if (!opts.compact) {
    ctx.fillStyle = CH.text;
    ctx.textAlign = 'center';
    ctx.fillText('accelera', cx, cy - size / 2 - 3);
    ctx.fillText('frena', cx, cy + size / 2 + 11);
    ctx.textAlign = 'left';
    ctx.fillText('dx', cx + size / 2 - 12, cy - 4);
    ctx.fillText('sx', cx - size / 2, cy - 4);
  }

  for (const gr of opts.groups || []) {
    ctx.fillStyle = gr.color;
    for (const [x, y] of gr.points) {
      ctx.fillRect(cx + clamp(x, -maxG, maxG) * k - 1, cy - clamp(y, -maxG, maxG) * k - 1, 2.2, 2.2);
    }
  }
  if (opts.live) {
    const { x, y, limit, trail } = opts.live;
    ctx.strokeStyle = 'rgba(243,156,18,0.8)';
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(cx, cy, Math.min(limit, maxG) * k, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    if (trail) {
      ctx.fillStyle = 'rgba(243,156,18,0.35)';
      for (const [tx, ty] of trail) ctx.fillRect(cx + tx * k - 1, cy - ty * k - 1, 2, 2);
    }
    ctx.fillStyle = '#f39c12';
    ctx.beginPath();
    ctx.arc(cx + clamp(x, -maxG, maxG) * k, cy - clamp(y, -maxG, maxG) * k, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  if (opts.groups && opts.groups.length && !opts.compact) {
    drawLegend(ctx, opts.groups.map(g => ({ label: g.label, color: g.color })), 8, 14);
  }
}
