// ============================================================
// MAIN.JS — Punto di ingresso
//
// Crea la popolazione, collega i comandi e fa girare il loop:
//   simula N passi → ridisegna la pista → aggiorna i pannelli
//
// Due "scene" possibili:
//   - ALLENAMENTO: la popolazione evolve (normale)
//   - DEMO: una sola auto (la campionessa, un cervello caricato,
//     oppure TU con la tastiera) su una pista a scelta.
//
// Tasti:
//   Spazio  pausa          +/-  velocita'      N  termina generazione
//   S       sensori        G    gate           Frecce  guida (in "Guida tu")
// ============================================================

const canvas = $('canvas');
const ctx = canvas.getContext('2d');

let population = new Population();
let demo = null;            // SoloRun attiva (o null)
let demoSkids = [];
let loadedBrain = null;     // { genome, name, meta } caricato da file
const demoResults = [];

const view = {
  speed: 1, paused: false, sensors: true, gates: false, deaths: true,
  paths: true, ghost: true, skids: true, lts: false, all: true
};

// ------------------------------------------------------------
// Comandi generali
// ------------------------------------------------------------
const SPEEDS = [1, 2, 4, 8, 16, 32, 64];
function setSpeed(dir) {
  const i = SPEEDS.indexOf(view.speed) + dir;
  view.speed = SPEEDS[clamp(i, 0, SPEEDS.length - 1)];
  $('speedLabel').textContent = view.speed + 'x';
}
function togglePause() {
  view.paused = !view.paused;
  $('btnPause').textContent = view.paused ? '▶ Riprendi' : '⏸ Pausa';
}
function resetAll() {
  const config = cloneConfig(population.config);   // mantiene i parametri scelti
  population = new Population(config);
  population._log('reset', 'Ricominciato da zero con cervelli casuali.');
  syncParams(); syncSetup(); syncTrainCtl();
  lastGen = -1;
}

$('btnPause').onclick = togglePause;
$('btnFaster').onclick = () => setSpeed(+1);
$('btnSlower').onclick = () => setSpeed(-1);
$('btnSkip').onclick = () => { if (!demo) population.evolve(); };
$('btnReset').onclick = resetAll;

const bindToggle = (id, key) => {
  const el = $(id);
  el.checked = view[key];
  el.onchange = () => (view[key] = el.checked);
  return el;
};
const optSensors = bindToggle('optSensors', 'sensors');
const optGates = bindToggle('optGates', 'gates');
bindToggle('optDeaths', 'deaths');
bindToggle('optPaths', 'paths');
bindToggle('optGhost', 'ghost');
bindToggle('optSkids', 'skids');
bindToggle('optLts', 'lts');
bindToggle('optAll', 'all');

// --- Schede ---
document.querySelectorAll('.tabs button').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab').forEach(t => (t.hidden = t.id !== 'tab-' + btn.dataset.tab));
    renderAllSlow();
  };
});

// --- Parametri genetici e setup ---
const syncParams = buildParams(() => population);
const syncSetup = buildSetupControls(() => population, () => { renderEngineering(population); renderTelemetry(population); });
$('optInteractions').checked = population.config.interactions;
$('optInteractions').onchange = e => (population.config.interactions = e.target.checked);
$('btnApplySetup').onclick = () => { if (!demo) population.restartGeneration(); };

// --- Modalita' di allenamento ---
function buildTrainCtl() {
  $('trainTrack').innerHTML = TRACK_DEFS.filter(d => d.role === 'train')
    .map(d => `<option value="${d.id}">${d.name}</option>`).join('');
  $('trainMode').onchange = e => { population.config.trackMode = e.target.value; syncTrainCtl(); };
  $('trainTrack').onchange = e => (population.config.trackId = e.target.value);
  $('btnApplyTrain').onclick = () => { if (!demo) population.restartGeneration(); };
}
function syncTrainCtl() {
  $('trainMode').value = population.config.trackMode;
  $('trainTrack').value = population.config.trackId;
  $('trainTrack').disabled = population.config.trackMode !== 'fixed';
}
buildTrainCtl();
syncTrainCtl();

// ------------------------------------------------------------
// Salva / carica il cervello
// ------------------------------------------------------------
$('btnSaveBrain').onclick = () => {
  const c = population.champion;
  if (!c) { $('brainInfo').textContent = 'Nessuna campionessa ancora: aspetta la fine della prima generazione.'; return; }
  const data = {
    format: 'car-evolution-brain', version: 2,
    name: c.name, generation: c.gen, trackId: c.trackId, fitness: c.fitness,
    networkSizes: c.sizes, inputs: INPUT_LABELS, outputs: OUTPUT_LABELS,
    setup: c.setup, record: population.records[c.trackId] ? population.records[c.trackId].frames / FPS : null,
    genome: c.genome
  };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cervello-${c.name.replace('#', '-')}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  $('brainInfo').textContent = `Scaricato ${c.name} (gen ${c.gen}, ${c.genome.length} pesi).`;
};

$('fileBrain').onchange = e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const d = JSON.parse(reader.result);
      const sizes = population.config.networkSizes;
      if (d.format !== 'car-evolution-brain') throw new Error('non è un file di cervello di Car Evolution');
      if (JSON.stringify(d.networkSizes) !== JSON.stringify(sizes)) throw new Error(`rete ${d.networkSizes} diversa da quella attuale ${sizes}`);
      if (d.genome.length !== NeuralNetwork.genomeLength(sizes)) throw new Error('numero di pesi sbagliato');
      loadedBrain = { genome: d.genome, name: d.name + '*', meta: d };
      $('brainInfo').innerHTML = `Caricato <b>${d.name}</b> (gen ${d.generation}, pista ${d.trackId}${d.record ? `, record ${d.record.toFixed(2)} s` : ''}).`;
      $('btnSeedBrain').disabled = false;
      $('demoDriver').querySelector('option[value="loaded"]').disabled = false;
    } catch (err) {
      $('brainInfo').textContent = 'Errore: ' + err.message;
    }
  };
  reader.readAsText(file);
};
$('btnSeedBrain').onclick = () => { if (loadedBrain) { population.seedFrom(loadedBrain.genome, loadedBrain.name); lastGen = -1; } };

// ------------------------------------------------------------
// DEMO e "Guida tu"
// ------------------------------------------------------------
$('demoTrack').innerHTML = TRACK_DEFS.map(d => `<option value="${d.id}">${d.name} (${d.role === 'test' ? 'esame' : 'allenamento'})</option>`).join('') +
  '<option value="random">Pista casuale nuova</option>';

const keys = { up: false, down: false, left: false, right: false };
let humanSteer = 0;

function startDemo() {
  const driver = $('demoDriver').value;
  let genome = null, name = 'Tu';
  if (driver === 'champion') {
    if (!population.champion) { $('demoInfo').textContent = 'Nessuna campionessa ancora: aspetta la fine della prima generazione.'; return; }
    genome = population.champion.genome; name = population.champion.name;
  } else if (driver === 'loaded') {
    if (!loadedBrain) { $('demoInfo').textContent = 'Carica prima un cervello (scheda Generalizzazione).'; return; }
    genome = loadedBrain.genome; name = loadedBrain.name;
  } else if (population.champion) {
    genome = population.champion.genome;   // la rete "osserva" mentre guidi tu
  }
  let trackId = $('demoTrack').value;
  if (trackId === 'random') trackId = 'proc-' + (500000 + Math.floor(Math.random() * 400000));
  demo = new SoloRun({
    genome, sizes: population.config.networkSizes, track: getTrack(trackId), setup: population.config.setup,
    laps: +$('demoLaps').value, lapTimeLimit: population.config.lapTimeLimit,
    driver: driver === 'human' ? 'human' : 'ai', name
  });
  demoSkids = [];
  humanSteer = 0;
  $('demoInfo').innerHTML = driver === 'human'
    ? '<b>Tocca a te!</b> ↑ gas, ↓ freno, ← → sterzo. Frena <i>prima</i> delle curve: con il freno premuto le gomme non hanno grip per girare.'
    : `In pista <b>${name}</b> su ${demo.track.name}. L'allenamento è in pausa.`;
  document.body.classList.add('demo-on');
}
function stopDemo() {
  demo = null;
  document.body.classList.remove('demo-on');
  $('demoInfo').textContent = 'Allenamento ripreso.';
}
$('btnDemoStart').onclick = startDemo;
$('btnDemoStop').onclick = stopDemo;

function recordDemoResult() {
  const c = demo.car, bl = c.bestLap();
  const lts = getLTS(demo.track, population.config.setup).time;
  demoResults.unshift({
    driver: demo.driver === 'human' ? '🧑 Tu' : '🤖 ' + demo.agent.name,
    track: demo.track.name, status: c.status, lap: bl ? bl.time : null,
    total: c.finishFrame, progress: c.progressLaps(demo.track, demo.laps) / demo.laps, lts
  });
  $('demoResults').innerHTML = `<thead><tr><th>Pilota</th><th>Pista</th><th>Esito</th><th>Gara</th><th>Miglior giro</th><th>vs LTS</th></tr></thead>
    <tbody>${demoResults.slice(0, 12).map(r => `<tr><td>${r.driver}</td><td>${r.track}</td>
      <td><span class="dot" style="background:${STATUS_INFO[r.status].color}"></span>${STATUS_INFO[r.status].label}</td>
      <td>${r.status === 'finished' ? fmtTime(r.total) : pct(r.progress)}</td><td>${fmtTime(r.lap)}</td>
      <td>${r.lap ? '+' + (r.lap / FPS - r.lts).toFixed(2) + ' s' : '—'}</td></tr>`).join('')}</tbody>`;
}

// ------------------------------------------------------------
// Tastiera
// ------------------------------------------------------------
const ARROWS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
window.addEventListener('keydown', e => {
  if (ARROWS[e.key] && demo && demo.driver === 'human') { keys[ARROWS[e.key]] = true; e.preventDefault(); return; }
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.key === ' ') { togglePause(); e.preventDefault(); }
  if (e.key === '+' || e.key === '=') setSpeed(+1);
  if (e.key === '-') setSpeed(-1);
  if ((e.key === 'n' || e.key === 'N') && !demo) population.evolve();
  if (e.key === 's' || e.key === 'S') { view.sensors = !view.sensors; optSensors.checked = view.sensors; }
  if (e.key === 'g' || e.key === 'G') { view.gates = !view.gates; optGates.checked = view.gates; }
});
window.addEventListener('keyup', e => { if (ARROWS[e.key]) keys[ARROWS[e.key]] = false; });

/** Tastiera → comandi analogici (lo sterzo si muove gradualmente, come un volante). */
function humanControls() {
  const target = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  humanSteer += clamp(target - humanSteer, -4 * DT, 4 * DT);
  return { throttle: keys.up ? 1 : keys.down ? -1 : 0, steer: humanSteer };
}

// ------------------------------------------------------------
// Disegno della pista
// ------------------------------------------------------------
function drawSpeedPath(tel, width = 3) {
  if (!tel || tel.length < TEL_STRIDE * 2) return;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  for (let i = TEL_STRIDE; i < tel.length; i += TEL_STRIDE) {
    const j = i - TEL_STRIDE;
    ctx.strokeStyle = speedColor(tel[i + TEL.kmh]);
    ctx.beginPath();
    ctx.moveTo(tel[j + TEL.x], tel[j + TEL.y]);
    ctx.lineTo(tel[i + TEL.x], tel[i + TEL.y]);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
}

function drawLtsLine(track) {
  const lts = getLTS(track, population.config.setup);
  const pts = track.centerPoints, n = pts.length;
  ctx.lineWidth = 4;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    ctx.strokeStyle = speedColor(toKmh(lts.speeds[i]));
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** Il "fantasma": il giro record rigiocato, sincronizzato col tempo di gara. */
function drawGhost(rec, frame) {
  const n = rec.tel.length / TEL_STRIDE;
  if (n < 2) return;
  const f = frame % rec.frames;
  const k = Math.min(n - 1, Math.floor(f / TEL_EVERY)) * TEL_STRIDE;
  Car.drawShape(ctx, rec.tel[k + TEL.x], rec.tel[k + TEL.y], rec.tel[k + TEL.h],
    rec.tel[k + TEL.steer] * 0.42, '#ffffff', 0.35);
}

function drawSkids(skids) {
  for (let i = 0; i < skids.length; i += 3) {
    ctx.fillStyle = skids[i + 2] ? 'rgba(140,105,60,0.35)' : 'rgba(10,10,10,0.45)';
    ctx.fillRect(skids[i] - 1, skids[i + 1] - 1, 2.5, 2.5);
  }
}

function drawDeaths() {
  for (const d of population.deaths) {
    const age = population.generation - d.gen;
    ctx.globalAlpha = Math.max(0.12, 0.8 - age * 0.14);
    if (d.type === 'crashed') {
      ctx.strokeStyle = '#e74c3c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(d.x - 4, d.y - 4); ctx.lineTo(d.x + 4, d.y + 4);
      ctx.moveTo(d.x + 4, d.y - 4); ctx.lineTo(d.x - 4, d.y + 4);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#b57edc';
      ctx.beginPath();
      ctx.arc(d.x, d.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

/** Scritte grandi nel punto piu' vuoto della pista. */
function drawOverlay(track) {
  const spot = track.emptySpot();
  const big = clamp(spot.d * 0.55, 26, 64);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.font = `bold ${big}px sans-serif`;
  ctx.fillText(demo ? (demo.driver === 'human' ? 'TU' : 'DEMO') : `GEN ${population.generation}`, spot.x, spot.y);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.font = '18px sans-serif';
  const frame = demo ? demo.frame : population.frame;
  ctx.fillText(`${(frame / FPS).toFixed(1)} s`, spot.x, spot.y + 26);
  if (!demo && population.firstFinishFrame !== null) {
    const left = Math.max(0, population.config.finishGrace * FPS - (population.frame - population.firstFinishFrame));
    ctx.fillStyle = 'rgba(241,196,15,0.9)';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText(`🏁 Fine gara tra ${(left / FPS).toFixed(1)} s`, spot.x, spot.y + 50);
  }
  if (view.paused) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText('⏸ PAUSA', spot.x, spot.y - big - 4);
  }
  ctx.restore();
}

function drawWorld() {
  const track = demo ? demo.track : population.track;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  track.draw(ctx);
  if (view.lts) drawLtsLine(track);
  if (view.gates) track.drawGates(ctx);
  if (view.skids) drawSkids(demo ? demoSkids : population.skids);
  if (view.deaths && !demo) drawDeaths();

  const rec = population.records[track.id];
  if (view.paths) {
    if (!demo && population.lastGenBest && population.lastGenBest.trackId === track.id) {
      ctx.globalAlpha = 0.35;
      drawSpeedPath(population.lastGenBest.tel, 2);
      ctx.globalAlpha = 1;
    }
    if (rec) drawSpeedPath(rec.tel, 3);
  }
  drawOverlay(track);
  if (view.ghost && rec) drawGhost(rec, demo ? demo.frame : population.frame);

  let focus;
  if (demo) {
    focus = demo.agent;
  } else {
    focus = population.leader();
    if (view.all) {
      for (const a of population.agents) {
        if (a.car.alive && a !== focus) a.car.draw(ctx, a.origin.type === 'elite' ? '#2ecc71' : '#3498db', 0.55);
      }
    }
  }
  if (focus) {
    if (view.sensors && focus.car.alive) focus.sensor.draw(ctx);
    focus.car.draw(ctx, demo && demo.driver === 'human' ? '#e84393' : '#f39c12');
  }
  return focus;
}

// --- Cerchio di aderenza live + rete ---
const ggTrail = [];
let ggFocus = null;
function drawLiveGG(agent) {
  if (!agent) return;
  if (agent !== ggFocus) { ggTrail.length = 0; ggFocus = agent; }
  const c = agent.car;
  ggTrail.push([c.gLat, c.gLong]);
  if (ggTrail.length > 90) ggTrail.shift();
  ggDiagram($('ggLive'), { maxG: 5, compact: true, live: { x: c.gLat, y: c.gLong, limit: c.gripAvail || 1, trail: ggTrail } });
  $('ggCap').textContent = `lat ${c.gLat.toFixed(2)} g · long ${c.gLong.toFixed(2)} g · limite ${(c.gripAvail || 0).toFixed(2)} g`;
}

function drawNetwork(agent) {
  const { ctx: nctx, w, h } = prepCanvas($('net'));
  if (agent) agent.brain.draw(nctx, 52, 8, w - 150, h - 16, INPUT_LABELS, OUTPUT_LABELS);
}

// ------------------------------------------------------------
// Loop
// ------------------------------------------------------------
let lastGen = -1;
let lastEvent = null;
let tick = 0;

function renderAllSlow() {
  renderLearning(population);
  renderTelemetry(population);
  renderEngineering(population);
  renderGeneralization(population);
}

function loop() {
  if (!view.paused) {
    if (demo) {
      const steps = demo.driver === 'human' ? 1 : view.speed;
      for (let i = 0; i < steps && !demo.done; i++) {
        if (demo.driver === 'human') demo.human = humanControls();
        demo.step();
        const c = demo.car;
        if ((c.sliding > 0.05 || c.onGrass) && c.age % 2 === 0) demoSkids.push(c.x, c.y, c.onGrass ? 1 : 0);
        if (demo.done) recordDemoResult();
      }
    } else {
      for (let i = 0; i < view.speed; i++) population.step();
    }
  }

  const focus = drawWorld();
  drawNetwork(focus);
  drawLiveGG(focus);

  if (tick % 6 === 0) {
    renderStatus(population, demo);
    const track = demo ? demo.track : population.track;
    renderLive($('live'), { agent: focus, track, laps: demo ? demo.laps : population.raceLaps }, population.bestSectors[track.id]);
    if (!demo) renderTower(population);
  }
  if (population.generation !== lastGen) {
    lastGen = population.generation;
    renderAllSlow();
  }
  if (population.events[0] !== lastEvent) {
    lastEvent = population.events[0];
    renderLog(population);
  }

  tick++;
  requestAnimationFrame(loop);
}

loop();
