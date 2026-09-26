// ============================================================
// DASHBOARD.JS — I pannelli di dati attorno alla pista
// ============================================================
// Solo visualizzazione: legge lo stato della simulazione e lo
// trasforma in HTML e grafici. Non contiene "learning".
// ============================================================

const STATUS_INFO = {
  running:  { label: 'In corsa',    color: '#3498db' },
  finished: { label: 'Arrivata',    color: '#f1c40f' },
  crashed:  { label: 'A muro',      color: '#e74c3c' },
  stalled:  { label: 'Bloccata',    color: '#b57edc' },
  timeout:  { label: 'Fuori tempo', color: '#7f8c8d' }
};

const pct = v => (v * 100).toFixed(0) + '%';
const $ = id => document.getElementById(id);
const secs = frames => (frames / FPS).toFixed(2);

/** Colore per una velocita': blu (lento) → verde → giallo → rosso (veloce). */
function speedColor(kmh) {
  const t = clamp((kmh - 50) / 230, 0, 1);
  return `hsl(${240 - 240 * t}, 85%, 55%)`;
}

function originText(origin, short = false) {
  if (!origin || origin.type === 'random') return short ? 'Casuale' : 'Cervello casuale (prima generazione)';
  if (origin.type === 'import') return short ? 'Importata' : 'Cervello caricato da file';
  if (origin.type === 'demo') return 'Campionessa in prova';
  if (origin.type === 'human') return 'Pilota umano (tu!)';
  if (origin.type === 'elite') {
    return short ? `Élite (era #${origin.prevRank})`
                 : `Élite: copiata identica, era #${origin.prevRank} nella generazione precedente`;
  }
  return short
    ? `#${origin.momRank} × #${origin.dadRank} · ${origin.mutations} mut.`
    : `Figlia di ${origin.mom} (#${origin.momRank}) × ${origin.dad} (#${origin.dadRank}), ${origin.mutations} pesi mutati`;
}

// ============================================================
// Barra di stato
// ============================================================
function renderStatus(pop, demo) {
  const card = (label, value, sub = '', color = '') =>
    `<div class="card"><div class="label">${label}</div>
       <div class="value" ${color ? `style="color:${color}"` : ''}>${value}</div>
       <div class="sub">${sub}</div></div>`;

  if (demo) {
    const c = demo.car;
    const rec = pop.records[demo.track.id];
    const lts = getLTS(demo.track, pop.config.setup);
    $('status').innerHTML =
      card('Modalità', demo.driver === 'human' ? 'Guidi tu' : 'Demo', 'l\'allenamento è in pausa', '#f39c12') +
      card('Pista', demo.track.name, `${Math.round(demo.track.lengthM)} m · ${demo.track.role === 'test' ? 'mai vista in allenamento' : 'allenamento'}`) +
      card('Tempo', secs(c.age) + ' s', `giro ${Math.min(c.laps.length + 1, demo.laps)} di ${demo.laps}`) +
      card('Velocità', Math.round(c.kmh) + ' km/h', `max ${Math.round(toKmh(c.topSpeed))} km/h`, '#3498db') +
      card('Stato', STATUS_INFO[c.status].label, c.onGrass ? 'sull\'erba!' : '', STATUS_INFO[c.status].color) +
      card('Miglior giro', c.bestLap() ? fmtTime(c.bestLap().time) : '—', 'in questa prova', '#2ecc71') +
      card('Record IA qui', rec ? fmtTime(rec.frames) : '—', rec ? `${rec.name}, gen ${rec.gen}` : 'mai corsa in allenamento') +
      card('Teorico (LTS)', lts.time.toFixed(2) + ' s', 'sulla linea centrale');
    return;
  }

  const c = pop.counts();
  const rec = pop.records[pop.track.id];
  const lts = getLTS(pop.track, pop.config.setup);
  let phase = `${pop.raceLaps} giri · max ${(pop.raceMaxFrames / FPS).toFixed(0)} s`;
  if (pop.firstFinishFrame !== null) {
    const left = Math.max(0, pop.config.finishGrace * FPS - (pop.frame - pop.firstFinishFrame));
    phase = `🏁 Stop tra ${(left / FPS).toFixed(1)} s`;
  }
  $('status').innerHTML =
    card('Generazione', pop.generation, `${pop.agents.length} auto`) +
    card('Pista', pop.track.name, `${Math.round(pop.track.lengthM)} m · ${modeLabel(pop.config.trackMode)}`) +
    card('Tempo gara', (pop.frame / FPS).toFixed(1) + ' s', phase) +
    card('In corsa', c.running, `${c.finished} arrivate`, STATUS_INFO.running.color) +
    card('A muro', c.crashed, 'contro le barriere', STATUS_INFO.crashed.color) +
    card('Bloccate', c.stalled, '3 s senza progressi', STATUS_INFO.stalled.color) +
    card('Record sul giro', rec ? fmtTime(rec.frames) : '—', rec ? `${rec.name}, gen ${rec.gen}` : 'nessun giro completo', '#2ecc71') +
    card('Teorico (LTS)', lts.time.toFixed(2) + ' s', rec ? `IA a +${((rec.frames / FPS) - lts.time).toFixed(2)} s` : 'limite fisico stimato');
}

const modeLabel = m => ({ fixed: 'pista fissa', rotate: 'rotazione', random: 'casuale ogni gen.' })[m] || m;

// ============================================================
// Pannello "Leader in diretta"
// ============================================================
function renderLive(el, info, bestSectors) {
  const { agent, track, laps } = info;
  if (!agent) { el.innerHTML = ''; return; }
  const { car, brain } = agent;
  const st = STATUS_INFO[car.status];
  const inputs = brain.lastOutputs[0] || [];
  const ctl = agent.lastControls || { throttle: 0, steer: 0 };
  const G = track.gates.length;
  const raceProgress = car.progressLaps(track, laps) / laps;

  // --- Settori del giro in corso, colorati come in TV ---
  const bs = bestSectors || [null, null, null];
  const lapNow = car.laps.length;
  const sectorCells = [0, 1, 2].map(k => {
    const s = car.currentSectors[k];
    const prev = car.laps.length ? car.laps[car.laps.length - 1].sectors[k] : null;
    if (s === undefined) return `<div class="sec pending">S${k + 1}<b>—</b></div>`;
    const cls = bs[k] !== null && s <= bs[k] ? 'purple' : prev !== null && s < prev ? 'green' : 'yellow';
    return `<div class="sec ${cls}">S${k + 1}<b>${secs(s)}</b></div>`;
  }).join('');

  // --- Sensori ---
  const sensorBars = inputs.slice(0, 7).map((v, i) => `<div class="sbar" title="S${i + 1}: ${v.toFixed(2)}">
      <div class="fill" style="height:${(v * 100).toFixed(0)}%;background:hsl(${120 - v * 120},70%,50%)"></div>
      <span>S${i + 1}</span></div>`).join('');

  // --- Altri ingressi: barre centrate sullo zero ---
  const others = inputs.slice(7).map((v, i) => {
    const left = v >= 0 ? 50 : 50 + v * 50;
    return `<div class="irow"><span>${INPUT_LABELS[7 + i]}</span>
      <div class="otrack"><div class="ozero"></div><div class="ofill ${v >= 0 ? 'pos' : 'neg'}" style="left:${left}%;width:${Math.min(1, Math.abs(v)) * 50}%"></div></div>
      <em>${v >= 0 ? '+' : ''}${v.toFixed(2)}</em></div>`;
  }).join('');

  const thr = Math.max(0, ctl.throttle), brk = Math.max(0, -ctl.throttle);
  const T = car.tyreTemp;
  const tColor = T < 80 ? '#5dade2' : T <= 110 ? '#2ecc71' : '#e74c3c';
  const badges = [
    car.onGrass ? '<span class="badge warn">ERBA</span>' : '',
    car.sliding > 0.05 ? `<span class="badge bad">SOTTOSTERZO ${pct(Math.min(1, car.sliding))}</span>` : '',
    car.slipstream > 0.05 ? `<span class="badge good">SCIA −${pct(car.slipstream * 0.4)} drag</span>` : '',
    car.gripUsage > 0.9 && car.sliding <= 0.05 ? '<span class="badge good">AL LIMITE</span>' : ''
  ].join('');

  el.innerHTML = `
    <div class="live-head">
      <span class="name">${agent.name}</span>
      <span class="tag" style="background:${st.color}">${st.label}</span>
      <span class="compound" style="border-color:${car.model.compound.color}">${car.model.compound.label[0]}</span>
    </div>
    <div class="origin">${originText(agent.origin)}${agent.bornGen ? ` · nata alla gen ${agent.bornGen}` : ''}</div>
    <div class="kv">
      <div><span>Giro</span><b>${Math.min(lapNow + 1, laps)} / ${laps}</b></div>
      <div><span>Tempo</span><b>${secs(car.finishFrame ?? car.age)}</b></div>
      <div><span>Velocità</span><b>${Math.round(car.kmh)} <small>km/h</small></b></div>
      <div><span>Grip usato</span><b>${pct(Math.min(car.gripUsage, 9.99))}</b></div>
    </div>
    <div class="pbar"><div style="width:${(raceProgress * 100).toFixed(1)}%"></div><span>${pct(raceProgress)} della gara · gate ${car.gatesPassed % G}/${G}</span></div>
    <div class="sectors">${sectorCells}</div>
    <div class="badges">${badges}</div>

    <div class="cockpit">
      <div class="pedals">
        <div class="pedal"><div class="pfill gas" style="height:${pct(thr)}"></div><span>GAS</span></div>
        <div class="pedal"><div class="pfill brake" style="height:${pct(brk)}"></div><span>FRENO</span></div>
      </div>
      <div class="wheel-box">
        <div class="wheel" style="transform:rotate(${(car.steer / car.model.maxSteer) * 120}deg)"><i></i></div>
        <span>sterzo ${(car.steer * 180 / Math.PI).toFixed(1)}°</span>
      </div>
      <div class="tyres">
        <div class="tyre-temp" style="color:${tColor}">${Math.round(T)}°C</div>
        <div class="wearbar"><div style="width:${pct(1 - car.tyreWear)}"></div></div>
        <span>gomme ${pct(1 - car.tyreWear)}</span>
      </div>
    </div>

    <h4>Cosa vede <small>(1 = bordo pista vicino)</small></h4>
    <div class="sensors">${sensorBars}</div>
    <h4>Cosa sente e sa <small>(gli altri 9 ingressi)</small></h4>
    <div class="inputs">${others}</div>`;
}

// ============================================================
// Torre dei tempi (classifica live, come in TV)
// ============================================================
function renderTower(pop) {
  const rows = pop.standings().slice(0, 10);
  if (!rows.length) { $('tower').innerHTML = '<p class="muted">Nessuna auto in pista.</p>'; return; }
  const leadGates = rows[0].a.car.progressGates(pop.track);
  const mPerGate = TRACK_SPACING / PX_PER_M;
  $('tower').innerHTML = `<table class="tower">${rows.map(({ a }, i) => {
    const c = a.car, last = c.laps.length ? c.laps[c.laps.length - 1].time : null;
    const gap = i === 0 ? 'Leader' : c.status === 'finished' ? '🏁 ' + secs(c.finishFrame) : '+' + Math.round((leadGates - c.progressGates(pop.track)) * mPerGate) + ' m';
    return `<tr><td class="pos">${i + 1}</td><td class="mono">${a.name}</td>
      <td>G${Math.min(c.laps.length + 1, pop.raceLaps)}</td><td>${gap}</td>
      <td class="muted">${last ? secs(last) : ''}</td>
      <td><div class="minibar"><div style="width:${pct(1 - c.tyreWear)}"></div></div></td></tr>`;
  }).join('')}</table>`;
}

// ============================================================
// Scheda APPRENDIMENTO
// ============================================================
function renderLearning(pop) {
  const H = pop.history;
  const last = H[H.length - 1];
  const L = last ? last.laps : pop.config.laps;

  lineChart($('chartFitness'), {
    series: [
      { label: 'migliore', color: '#f39c12', values: H.map(h => h.best) },
      { label: 'mediana', color: '#9b59b6', values: H.map(h => h.median), width: 1.5 },
      { label: 'media', color: '#3498db', values: H.map(h => h.avg) }
    ],
    hLines: [{ y: L, label: 'traguardo', color: 'rgba(241,196,15,0.7)' }],
    yMin: 0, fmt: v => v.toFixed(1)
  });
  $('capFitness').innerHTML = last
    ? `Ultima gen: migliore <b>${last.best.toFixed(2)}</b>, media <b>${last.avg.toFixed(2)}</b> (in giri: sopra ${L} = arrivata).` : '';

  stackedBars($('chartOutcome'), {
    rows: H.map(h => [h.finished, h.crashed, h.stalled, h.timeout]),
    colors: [STATUS_INFO.finished.color, STATUS_INFO.crashed.color, STATUS_INFO.stalled.color, STATUS_INFO.timeout.color],
    labels: ['arrivate', 'a muro', 'bloccate', 'fuori tempo']
  });
  $('capOutcome').innerHTML = last
    ? `Ultima gen: <b>${last.finished}</b> arrivate, <b>${last.crashed}</b> a muro, <b>${last.stalled}</b> bloccate, <b>${last.timeout}</b> fuori tempo.` : '';

  lineChart($('chartDiversity'), {
    series: [{ label: 'diversità (dev. std media dei pesi)', color: '#1abc9c', values: H.map(h => h.diversity) }],
    yMin: 0, fmt: v => v.toFixed(2)
  });
  $('capDiversity').innerHTML = last
    ? `Diversità <b>${last.diversity.toFixed(3)}</b> · genitori distinti <b>${last.parents}</b>/${last.total} · <b>${last.avgMutations.toFixed(1)}</b> pesi mutati per figlia.` : '';

  const fits = last ? last.fitnesses : [];
  histogram($('chartHist'), {
    values: fits, bins: 24,
    xMax: Math.max(L * 1.05, ...(fits.length ? fits : [0])) * 1.02,
    markers: last ? [{ x: L, label: 'traguardo', color: 'rgba(241,196,15,0.8)' }] : [],
    colorOf: x => (x >= L ? STATUS_INFO.finished.color : '#3498db'),
    legend: [{ label: 'non arrivate', color: '#3498db' }, { label: 'arrivate', color: STATUS_INFO.finished.color }]
  });
  $('capHist').innerHTML = last ? `Mediana <b>${last.median.toFixed(2)}</b> giri. La coda a destra genera quasi tutte le figlie.` : '';

  renderLeaderboard(pop);
}

function renderLeaderboard(pop) {
  const rows = pop.lastRanked.slice(0, 15);
  if (!rows.length) {
    $('leaderboard').innerHTML = '<tr><td class="muted">La classifica appare alla fine della prima generazione.</td></tr>';
    return;
  }
  const maxChildren = Math.max(1, ...pop.lastRanked.map(r => r.children));
  $('leaderboard').innerHTML = `
    <thead><tr><th>#</th><th>Nome</th><th>Origine</th><th>Esito</th><th>Gara</th><th>Miglior giro</th>
      <th>V max</th><th title="% di tempo sull'erba">Erba</th><th>Gomme</th><th>Fitness</th><th>Figlie</th></tr></thead>
    <tbody>${rows.map(r => {
      const st = STATUS_INFO[r.status];
      return `<tr class="${r.rank <= pop.config.eliteCount ? 'elite' : ''}">
        <td>${r.rank}</td><td class="mono">${r.name}</td><td class="muted">${originText(r.origin, true)}</td>
        <td><span class="dot" style="background:${st.color}"></span>${st.label}</td>
        <td>${r.status === 'finished' ? fmtTime(r.time) : pct(r.progress / Math.max(1, pop.history[pop.history.length - 1].laps))}</td>
        <td>${fmtTime(r.bestLap)}</td><td>${Math.round(r.topSpeed)}</td><td>${pct(r.grassPct)}</td>
        <td>${pct(1 - r.wear)}</td><td><b>${r.fitness.toFixed(2)}</b></td>
        <td><div class="kids"><div style="width:${(r.children / maxChildren) * 100}%"></div><span>${r.children}</span></div></td>
      </tr>`;
    }).join('')}</tbody>`;
}

const LOG_ICONS = { start: '🧬', finish: '🏁', record: '🏆', milestone: '⭐', progress: '📈', gen: '•', reset: '↺', track: '🗺️', import: '📥' };
function renderLog(pop) {
  $('log').innerHTML = pop.events.slice(0, 80).map(e =>
    `<li class="ev-${e.type}"><span class="icon">${LOG_ICONS[e.type] || '•'}</span>
       <span class="gen">G${e.gen}</span><span>${e.text}</span></li>`).join('');
}

// ============================================================
// Scheda TELEMETRIA
// ============================================================
/** Estrae [x, y] da una telemetria piatta. */
function telSeries(tel, fieldX, fieldY, scaleY = 1) {
  const pts = [];
  for (let i = 0; i < tel.length; i += TEL_STRIDE) pts.push([tel[i + fieldX], tel[i + fieldY] * scaleY]);
  return pts;
}

function renderTelemetry(pop) {
  const track = pop.track;
  const rec = pop.records[track.id];
  const gb = pop.lastGenBest && pop.lastGenBest.trackId === track.id ? pop.lastGenBest : null;
  const lts = getLTS(track, pop.config.setup);
  const Lm = track.lengthM;
  const fmtX = v => Math.round(v * Lm) + ' m';
  const G = track.gates.length;
  const markers = [
    { x: track.sectorGates[0] / G, label: 'S2' },
    { x: track.sectorGates[1] / G, label: 'S3' }
  ];
  const ltsPts = lts.speeds.map((v, i) => [track.distM[i] / Lm, toKmh(v)]);
  const empty = 'Nessun giro completo su questa pista (ancora)';

  $('telTitle').textContent = `${track.name} · ${Math.round(Lm)} m`;

  xyChart($('chartSpeed'), {
    series: [
      { label: 'teorico (LTS)', color: 'rgba(255,255,255,0.45)', points: ltsPts, dash: [4, 4], width: 1.2 },
      { label: gb ? `migliore gen ${gb.gen} (${secs(gb.frames)} s)` : '', color: '#3498db', points: gb ? telSeries(gb.tel, TEL.dist, TEL.kmh) : [] },
      { label: rec ? `record ${rec.name} (${secs(rec.frames)} s)` : '', color: '#2ecc71', points: rec ? telSeries(rec.tel, TEL.dist, TEL.kmh) : [], width: 2 }
    ],
    xMin: 0, xMax: 1, yMin: 0, fmtX, fmtY: v => Math.round(v) + '', xMarkers: markers, breakOnXDrop: true, empty
  });

  xyChart($('chartPedals'), {
    series: [
      { label: 'gas', color: '#2ecc71', points: rec ? telSeries(rec.tel, TEL.dist, TEL.thr, 100) : [], fill: 'rgba(46,204,113,0.18)' },
      { label: 'freno', color: '#e74c3c', points: rec ? telSeries(rec.tel, TEL.dist, TEL.brk, 100) : [], fill: 'rgba(231,76,60,0.25)' }
    ],
    xMin: 0, xMax: 1, yMin: 0, yMax: 100, fmtX, fmtY: v => v.toFixed(0) + '%', xMarkers: markers, breakOnXDrop: true, empty
  });

  xyChart($('chartSteer'), {
    series: [
      { label: 'sterzo (−sx / +dx)', color: '#f39c12', points: rec ? telSeries(rec.tel, TEL.dist, TEL.steer, 100) : [] },
      { label: 'uso del grip', color: '#b57edc', points: rec ? telSeries(rec.tel, TEL.dist, TEL.use, 100) : [], width: 1.2 }
    ],
    xMin: 0, xMax: 1, yMin: -100, yMax: 150, fmtX, fmtY: v => v.toFixed(0) + '%', xMarkers: markers, breakOnXDrop: true,
    hLines: [{ y: 100, label: 'limite di aderenza', color: 'rgba(231,76,60,0.6)' }], empty
  });

  xyChart($('chartTyres'), {
    series: [
      { label: 'temperatura gomme (°C)', color: '#e67e22', points: rec ? telSeries(rec.tel, TEL.dist, TEL.temp) : [] }
    ],
    xMin: 0, xMax: 1, yMin: 40, yMax: 150, fmtX, fmtY: v => v.toFixed(0) + '°', xMarkers: markers, breakOnXDrop: true,
    hLines: [{ y: TYRE_OPT_TEMP, label: 'ottimale', color: 'rgba(46,204,113,0.7)' }], empty
  });

  ggDiagram($('chartGG'), {
    maxG: 5,
    groups: [
      ...(gb ? [{ label: 'migliore gen.', color: 'rgba(52,152,219,0.55)', points: telSeries(gb.tel, TEL.glat, TEL.glong) }] : []),
      ...(rec ? [{ label: 'record', color: 'rgba(46,204,113,0.8)', points: telSeries(rec.tel, TEL.glat, TEL.glong) }] : [])
    ]
  });

  // --- Tabella settori ---
  const bs = pop.bestSectors[track.id] || [null, null, null];
  const ideal = bs.every(s => s !== null) ? bs[0] + bs[1] + bs[2] : null;
  const ltsSector = (a, b) => {
    let t = 0;
    for (let i = a; i !== b; i = (i + 1) % G) t += track.segLenM[i] / Math.max(0.5, (lts.speeds[i] + lts.speeds[(i + 1) % G]) / 2);
    return t;
  };
  const sg = track.sectorGates;
  const ltsS = [ltsSector(0, sg[0]), ltsSector(sg[0], sg[1]), ltsSector(sg[1], 0)];
  // celle gia' formattate: tempi in frame → secondi
  const fr = arr => (arr ? arr.map(s => (s === null || s === undefined ? '—' : secs(s))) : ['—', '—', '—']);
  const row = (label, cells, total, cls = '') =>
    `<tr class="${cls}"><td>${label}</td>${cells.map(c => `<td>${c}</td>`).join('')}<td><b>${total}</b></td></tr>`;
  $('sectors').innerHTML = `<thead><tr><th></th><th>S1</th><th>S2</th><th>S3</th><th>Giro</th></tr></thead><tbody>
    ${row('Giro record', fr(rec && rec.sectors), rec ? secs(rec.frames) : '—', 'rec')}
    ${row('Migliori settori', fr(bs), '—', 'purple')}
    ${row('Giro ideale', ['', '', ''], ideal ? secs(ideal) : '—', 'purple')}
    ${row('Migliore ultima gen.', fr(gb && gb.sectors), gb ? secs(gb.frames) : '—')}
    ${row('Teorico (LTS)', ltsS.map(v => v.toFixed(2)), lts.time.toFixed(2), 'lts')}
  </tbody>`;
  $('capSectors').innerHTML = ideal && rec
    ? `Il "giro ideale" somma i migliori settori mai fatti (anche da auto diverse): <b>${secs(ideal)} s</b>. ` +
      `Il record è a <b>${((rec.frames - ideal) / FPS).toFixed(2)} s</b> dal giro ideale: margine che l'evoluzione può ancora trovare.`
    : 'Servono giri completi per confrontare i settori.';

  // --- Tempi sul giro per generazione (solo questa pista) ---
  const H = pop.history;
  let best = null;
  lineChart($('chartLapTimes'), {
    series: [
      { label: 'miglior giro della gen.', color: '#3498db', values: H.map(h => (h.trackId === track.id && h.bestLap ? h.bestLap / FPS : null)), dots: true },
      { label: 'record', color: '#2ecc71', step: true, values: H.map(h => {
        if (h.trackId === track.id && h.bestLap && (best === null || h.bestLap < best)) best = h.bestLap;
        return best === null ? null : best / FPS;
      }) }
    ],
    hLines: [{ y: lts.time, label: `teorico ${lts.time.toFixed(1)} s`, color: 'rgba(255,255,255,0.5)' }],
    fmt: v => v.toFixed(1) + 's', empty: 'Nessun giro completo su questa pista'
  });
}

// ============================================================
// Scheda INGEGNERIA
// ============================================================
function vehicleSheet(setup) {
  const m = new VehicleModel(setup);
  const accelTime = target => {
    let v = 0, t = 0;
    while (v < target && t < 30) {
      const a = Math.min(m.engineAccel(v), m.grip(v)) - m.resistance(v);
      v += a * 0.005; t += 0.005;
    }
    return t;
  };
  const v250 = 250 / 3.6;
  return {
    top: toKmh(m.topSpeed()),
    t100: accelTime(100 / 3.6),
    t200: accelTime(200 / 3.6),
    g100: m.grip(100 / 3.6) / G_ACC,
    g250: m.grip(v250) / G_ACC,
    downforceKg: m.kDown * v250 * v250 * m.mass / G_ACC,
    dragKW: m.kDrag * v250 * v250 * m.mass * v250 / 1000,
    brake: m.brakingDistance(200 / 3.6, 80 / 3.6),
    corners: [15, 30, 60, 120].map(R => [R, Math.min(toKmh(m.cornerSpeed(R)), toKmh(m.topSpeed()))])
  };
}

function renderEngineering(pop) {
  const setup = pop.config.setup;
  const track = pop.track;
  const s = vehicleSheet(setup);
  const lts = getLTS(track, setup);
  const item = (label, value, hint) => `<div class="spec"><span>${label}</span><b>${value}</b><em>${hint}</em></div>`;
  $('techsheet').innerHTML =
    item('Velocità di punta', Math.round(s.top) + ' km/h', 'dove potenza = resistenze') +
    item('0 → 100 km/h', s.t100.toFixed(2) + ' s', 'limitato dal grip') +
    item('0 → 200 km/h', s.t200.toFixed(2) + ' s', 'poi limitato dalla potenza') +
    item('Frenata 200 → 80', Math.round(s.brake) + ' m', 'grip + drag') +
    item('Grip a 100 km/h', s.g100.toFixed(2) + ' g', 'meccanico') +
    item('Grip a 250 km/h', s.g250.toFixed(2) + ' g', 'con carico aerodinamico') +
    item('Carico a 250 km/h', Math.round(s.downforceKg) + ' kg', 'la macchina "pesa" di più') +
    item('Potenza persa nel drag', Math.round(s.dragKW) + ' kW', 'a 250 km/h') +
    s.corners.map(([R, v]) => item(`Curva R = ${R} m`, Math.round(v) + ' km/h', 'velocità massima')).join('') +
    item(`LTS ${track.name}`, lts.time.toFixed(2) + ' s', `${Math.round(toKmh(Math.min(...lts.speeds)))}–${Math.round(toKmh(Math.max(...lts.speeds)))} km/h`);

  // --- Velocita' massima in curva vs raggio ---
  const radii = [];
  for (let R = 8; R <= 300; R *= 1.08) radii.push(R);
  const curve = (w, cap) => {
    const m = new VehicleModel({ ...setup, wing: w });
    const top = toKmh(m.topSpeed());
    return radii.map(R => [R, Math.min(top, toKmh(m.cornerSpeed(R)), cap)]);
  };
  // Le curve della pista: minimi locali del raggio
  const Rs = track.radiusM, n = Rs.length;
  const apex = [];
  for (let i = 0; i < n; i++) {
    const R = Rs[i];
    if (R < 250 && R <= Rs[(i - 1 + n) % n] && R <= Rs[(i + 1) % n] && R <= Rs[(i - 2 + n) % n] && R <= Rs[(i + 2) % n]) {
      apex.push([R, toKmh(lts.speeds[i])]);
    }
  }
  xyChart($('chartCorner'), {
    series: [
      { label: 'ala 0 (scarico)', color: '#5dade2', points: curve(0, 400), dash: [4, 4], width: 1.2 },
      { label: 'ala 1 (carico)', color: '#e74c3c', points: curve(1, 400), dash: [4, 4], width: 1.2 },
      { label: 'setup attuale', color: '#f39c12', points: curve(setup.wing, 400), width: 2.2 },
      { label: 'curve di questa pista (LTS)', color: '#2ecc71', points: apex, dots: true, width: 0.01 }
    ],
    xMin: 8, xMax: 300, yMin: 0, fmtX: v => Math.round(v) + ' m', fmtY: v => Math.round(v) + ''
  });
  $('capCorner').innerHTML = `Il carico aerodinamico conta di più nelle curve veloci (raggio grande): lì le curve si allargano a ventaglio. ` +
    `I punti verdi sono le <b>${apex.length}</b> curve di ${track.name}, alla velocità del profilo teorico.`;

  // --- Tempo sul giro vs ala (ottimizzazione del setup) ---
  const sweep = id => {
    const t = getTrack(id);
    const pts = [];
    for (let w = 0; w <= 1.0001; w += 0.1) pts.push([w, getLTS(t, { ...setup, wing: +w.toFixed(1) }).time]);
    return pts;
  };
  const cur = sweep(track.id);
  const best = cur.reduce((a, b) => (b[1] < a[1] ? b : a));
  const otherId = track.id === 'anello' ? 'evoluzione' : 'anello';
  const other = sweep(otherId);
  const norm = pts => pts.map(([w, t]) => [w, (t / pts[0][1] - 1) * 100]);
  xyChart($('chartWing'), {
    series: [
      { label: track.name, color: '#f39c12', points: norm(cur), dots: true, width: 2 },
      { label: getTrack(otherId).name, color: '#5dade2', points: norm(other), dots: true, dash: [4, 3] }
    ],
    xMin: 0, xMax: 1, fmtX: v => v.toFixed(2), fmtY: v => (v > 0 ? '+' : '') + v.toFixed(1) + '%',
    xMarkers: [{ x: setup.wing, label: 'attuale', color: '#f39c12' }]
  });
  $('capWing').innerHTML = `Su ${track.name} l'ala ottimale (LTS) è <b>${best[0].toFixed(1)}</b> → <b>${best[1].toFixed(2)} s</b>. ` +
    `Più ala = più veloce in curva ma più lento sul dritto. Ogni pista ha il suo compromesso (tempi relativi all'ala 0).`;
}

/** Controlli del setup (costruiti una volta). */
function buildSetupControls(getPop, onChange) {
  const S = [
    { key: 'powerKW', label: 'Potenza motore', min: 400, max: 1000, step: 25, fmt: v => v + ' kW' },
    { key: 'wing', label: 'Ala (carico aerodinamico)', min: 0, max: 1, step: 0.05, fmt: v => (+v).toFixed(2) },
    { key: 'mass', label: 'Massa', min: 700, max: 950, step: 10, fmt: v => v + ' kg' }
  ];
  $('setup').innerHTML = S.map(p => `
    <div class="param"><div class="param-head"><label for="s-${p.key}">${p.label}</label><b id="sv-${p.key}"></b></div>
      <input type="range" id="s-${p.key}" min="${p.min}" max="${p.max}" step="${p.step}"></div>`).join('') + `
    <div class="param"><div class="param-head"><label for="s-compound">Mescola gomme</label></div>
      <select id="s-compound">${Object.entries(COMPOUNDS).map(([k, c]) => `<option value="${k}">${c.label} — grip ${c.mu}, usura ×${c.wear}</option>`).join('')}</select></div>`;

  const sync = () => {
    const setup = getPop().config.setup;
    for (const p of S) { $(`s-${p.key}`).value = setup[p.key]; $(`sv-${p.key}`).textContent = p.fmt(setup[p.key]); }
    $('s-compound').value = setup.compound;
  };
  for (const p of S) {
    $(`s-${p.key}`).addEventListener('input', e => {
      getPop().config.setup[p.key] = +e.target.value;
      $(`sv-${p.key}`).textContent = p.fmt(+e.target.value);
      onChange();
    });
  }
  $('s-compound').addEventListener('change', e => { getPop().config.setup.compound = e.target.value; onChange(); });
  sync();
  return sync;
}

// ============================================================
// Scheda GENERALIZZAZIONE
// ============================================================
function renderGeneralization(pop) {
  const E = pop.exams;
  const tests = testTrackIds();
  const colors = ['#e74c3c', '#9b59b6', '#1abc9c'];
  xyChart($('chartOverfit'), {
    series: [
      { label: 'pista di allenamento', color: '#2ecc71', points: E.map(e => [e.gen, e.train.progress * 100]), width: 2.2 },
      { label: 'media esame', color: '#f39c12', points: E.map(e => [e.gen, e.testAvg * 100]), width: 2.2 },
      ...tests.map((id, k) => ({
        label: getTrack(id).name, color: colors[k % colors.length], dash: [4, 3], width: 1.2,
        points: E.map(e => [e.gen, (e.tests.find(t => t.id === id)?.progress || 0) * 100])
      }))
    ],
    yMin: 0, yMax: 100, fmtX: v => 'G' + Math.round(v), fmtY: v => v.toFixed(0) + '%',
    empty: 'L\'esame parte alla fine della prima generazione'
  });

  const last = E[E.length - 1];
  if (!last) { $('examTable').innerHTML = ''; $('capOverfit').innerHTML = ''; return; }
  const all = [{ ...last.train, role: 'allenamento' }, ...last.tests.map(t => ({ ...t, role: 'esame' }))];
  $('examTable').innerHTML = `<thead><tr><th>Pista</th><th>Ruolo</th><th>Esito</th><th>Giro</th><th>Tempo</th><th>LTS</th></tr></thead>
    <tbody>${all.map(r => {
      const st = STATUS_INFO[r.status];
      const lts = getLTS(getTrack(r.id), pop.config.setup).time;
      return `<tr><td>${r.name}</td><td class="${r.role === 'esame' ? 'warn-t' : 'muted'}">${r.role}</td>
        <td><span class="dot" style="background:${st.color}"></span>${st.label}</td>
        <td>${pct(r.progress)}</td><td>${fmtTime(r.time)}</td><td class="muted">${lts.toFixed(2)} s</td></tr>`;
    }).join('')}</tbody>`;
  const gapPct = (last.train.progress - last.testAvg) * 100;
  $('capOverfit').innerHTML = `Campionessa <b>${last.name}</b> (gen ${last.gen}): allenamento <b>${pct(last.train.progress)}</b>, esame <b>${pct(last.testAvg)}</b>. ` +
    (gapPct > 30 ? '<b class="red">Forte overfitting</b>: ha imparato la pista, non a guidare. Prova la modalità "rotazione" o "casuale".'
      : gapPct > 10 ? 'Un po\' di overfitting: va meglio sulla pista che conosce.'
      : 'Buona generalizzazione: guida bene anche dove non è mai stata.');
}

// ============================================================
// Slider dei parametri genetici
// ============================================================
const PARAMS = [
  { key: 'mutationRate', label: 'Probabilità di mutazione', min: 0, max: 0.3, step: 0.01, fmt: v => pct(v),
    help: 'Quota di pesi che cambiano in ogni figlia. Bassa: evoluzione lenta. Alta: le figlie "dimenticano" quello che sapevano i genitori.' },
  { key: 'mutationStrength', label: 'Intensità della mutazione', min: 0, max: 1.5, step: 0.05, fmt: v => v.toFixed(2),
    help: 'Di quanto si sposta un peso quando muta. Grande = salti grossi (esplora), piccola = ritocchi (rifinisce).' },
  { key: 'tournamentSize', label: 'Dimensione del torneo', min: 2, max: 12, step: 1, fmt: v => v,
    help: 'Tra quante auto scegliere ogni genitore. Alta = si riproducono quasi solo le migliori (selezione severa, meno diversità).' },
  { key: 'eliteCount', label: 'Élite', min: 0, max: 10, step: 1, fmt: v => v,
    help: 'Quante migliori passano identiche. Con 0 il record può anche peggiorare da una generazione all\'altra.' },
  { key: 'populationSize', label: 'Popolazione', min: 20, max: 300, step: 10, fmt: v => v,
    help: 'Più auto = più tentativi per generazione, ma simulazione più lenta.' },
  { key: 'laps', label: 'Giri per gara', min: 1, max: 5, step: 1, fmt: v => v,
    help: 'Con più giri conta la gestione delle gomme (usura e temperatura). La generazione finisce alla fine della gara.' }
];

function buildParams(getPop) {
  $('params').innerHTML = PARAMS.map(p => `
    <div class="param">
      <div class="param-head"><label for="p-${p.key}">${p.label}</label><b id="pv-${p.key}"></b></div>
      <input type="range" id="p-${p.key}" min="${p.min}" max="${p.max}" step="${p.step}">
      <p>${p.help}</p>
    </div>`).join('');
  const sync = () => {
    for (const p of PARAMS) {
      $(`p-${p.key}`).value = getPop().config[p.key];
      $(`pv-${p.key}`).textContent = p.fmt(getPop().config[p.key]);
    }
  };
  for (const p of PARAMS) {
    $(`p-${p.key}`).addEventListener('input', e => {
      getPop().config[p.key] = +e.target.value;
      $(`pv-${p.key}`).textContent = p.fmt(+e.target.value);
    });
  }
  sync();
  return sync;
}
