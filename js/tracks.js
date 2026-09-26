// ============================================================
// TRACKS.JS — Catalogo dei circuiti + generatore procedurale
// ============================================================
//
// ALLENAMENTO vs ESAME (il problema dell'OVERFITTING)
// Se le auto si allenano sempre sulla stessa pista, rischiano di
// impararla "a memoria" invece di imparare a GUIDARE.
// Per scoprirlo si fa come a scuola:
//   - piste di ALLENAMENTO: quelle su cui evolvono
//   - piste di ESAME: MAI viste durante l'allenamento
// Se il campione va forte in allenamento ma si schianta all'esame,
// ha fatto overfitting.
// ============================================================

// Punti di controllo: la pista vera e' la curva liscia che ci passa
// attraverso (Catmull-Rom). Canvas 1200x800.
// Regole: tratti non consecutivi lontani piu' di 2·(asfalto+erba),
// raggio delle curve maggiore di (asfalto+erba). Track.validate() controlla.
const CIRCUIT_EVOLUZIONE = [
  // Rettilineo principale (partenza), verso destra
  { x: 260, y: 730 }, { x: 480, y: 738 }, { x: 700, y: 735 }, { x: 880, y: 720 },
  // Curva 1 a sinistra, poi chicane sinistra-destra
  { x: 975, y: 665 }, { x: 1000, y: 595 }, { x: 965, y: 540 }, { x: 980, y: 478 }, { x: 1055, y: 440 },
  // Curvone veloce sul lato destro
  { x: 1120, y: 380 }, { x: 1140, y: 290 }, { x: 1120, y: 190 }, { x: 1060, y: 110 },
  // Rettilineo opposto, verso sinistra
  { x: 950, y: 75 }, { x: 800, y: 80 }, { x: 650, y: 75 }, { x: 500, y: 85 }, { x: 350, y: 90 },
  // Curva a sinistra in cima e discesa
  { x: 230, y: 100 }, { x: 140, y: 150 }, { x: 110, y: 230 },
  // Esse nel campo interno verso destra
  { x: 140, y: 300 }, { x: 240, y: 320 }, { x: 380, y: 290 }, { x: 520, y: 320 }, { x: 650, y: 290 },
  // Tornante
  { x: 760, y: 320 }, { x: 800, y: 390 }, { x: 760, y: 450 },
  // Ritorno verso sinistra con esse
  { x: 650, y: 460 }, { x: 540, y: 430 }, { x: 430, y: 470 }, { x: 320, y: 450 }, { x: 200, y: 470 },
  // Ultima curva: si torna sul rettilineo
  { x: 120, y: 540 }, { x: 110, y: 640 }, { x: 160, y: 710 }
];

const CIRCUIT_ANELLO = [
  { x: 250, y: 700 }, { x: 600, y: 720 }, { x: 950, y: 690 }, { x: 1100, y: 560 },
  { x: 1120, y: 400 }, { x: 1060, y: 250 }, { x: 950, y: 130 }, { x: 760, y: 90 },
  { x: 600, y: 170 }, { x: 450, y: 90 }, { x: 260, y: 110 }, { x: 130, y: 230 },
  { x: 100, y: 400 }, { x: 150, y: 580 }
];

const CIRCUIT_ESAME = [
  { x: 300, y: 725 }, { x: 560, y: 735 }, { x: 760, y: 715 }, { x: 880, y: 660 },
  { x: 900, y: 560 }, { x: 830, y: 480 }, { x: 850, y: 385 }, { x: 960, y: 330 },
  { x: 1090, y: 300 }, { x: 1130, y: 200 }, { x: 1060, y: 100 }, { x: 900, y: 80 },
  { x: 750, y: 130 }, { x: 620, y: 220 }, { x: 500, y: 190 }, { x: 400, y: 100 },
  { x: 260, y: 90 }, { x: 150, y: 160 }, { x: 120, y: 300 }, { x: 180, y: 400 },
  { x: 140, y: 520 }, { x: 130, y: 640 }, { x: 190, y: 710 }
];

const TRACK_DEFS = [
  { id: 'evoluzione', name: 'Autodromo Evoluzione', role: 'train', ctrl: CIRCUIT_EVOLUZIONE },
  { id: 'anello', name: 'Anello Veloce', role: 'train', ctrl: CIRCUIT_ANELLO },
  { id: 'proc-7', name: 'Procedurale #7', role: 'train', seed: 7 },
  { id: 'esame', name: "Circuito d'Esame", role: 'test', ctrl: CIRCUIT_ESAME },
  { id: 'proc-4242', name: 'Procedurale #4242', role: 'test', seed: 4242 }
];

const TRACK_OPTS = { halfWidth: 32, runoff: 12 };
const TRACK_SPACING = 32;   // un punto (= un gate) ogni 32 px = 6.4 m

function trackFromControlPoints(ctrl, id, name) {
  return new Track(resampleClosed(catmullRomClosed(ctrl, 20), TRACK_SPACING), { id, name, ...TRACK_OPTS });
}

// ============================================================
// GENERATORE PROCEDURALE
// ============================================================
// Idea: punti attorno al centro del canvas, a raggio casuale.
// Siccome ogni punto sta a un angolo diverso e crescente, il
// giro non si incrocia mai ("forma stellata"). Poi:
//   spline → ricampionamento → VALIDAZIONE.
// Se la validazione fallisce (curva troppo stretta, tratti troppo
// vicini...) si riprova con un altro seed. E' il classico schema
// "genera e verifica".
// ============================================================
function randomControlPoints(rng) {
  const n = 11 + Math.floor(rng() * 6);   // 11..16 punti
  const cx = 600, cy = 400, rx = 500, ry = 315;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const theta = (2 * Math.PI * i) / n + (rng() - 0.5) * (Math.PI / n);
    const r = 0.5 + 0.5 * rng();
    pts.push({ x: cx + rx * r * Math.cos(theta), y: cy + ry * r * Math.sin(theta) });
  }
  return pts;
}

/** La partenza va sul tratto piu' dritto: ruotiamo l'array dei punti. */
function rotateToStraightest(points) {
  const n = points.length, W = 5;
  const turn = points.map((c, i) => {
    const p = points[(i - 1 + n) % n], q = points[(i + 1) % n];
    return Math.abs(angleDiff(Math.atan2(q.y - c.y, q.x - c.x), Math.atan2(c.y - p.y, c.x - p.x)));
  });
  let best = 0, bestScore = Infinity;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -W; k <= W; k++) s += turn[(i + k + n) % n];
    if (s < bestScore) { bestScore = s; best = i; }
  }
  return [...points.slice(best), ...points.slice(0, best)];
}

function generateTrack(seed, name) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const s = seed + attempt * 7919;
    const ctrl = randomControlPoints(mulberry32(s));
    const pts = rotateToStraightest(resampleClosed(catmullRomClosed(ctrl, 20), TRACK_SPACING));
    const track = new Track(pts, { id: `proc-${seed}`, name: name || `Procedurale #${seed}`, ...TRACK_OPTS });
    track.attempts = attempt + 1;
    if (track.validate().ok) return track;
  }
  throw new Error('Nessuna pista valida trovata per il seed ' + seed);
}

const _trackCache = new Map();
/** Restituisce (e memorizza) la pista con quell'id. */
function getTrack(id) {
  if (_trackCache.has(id)) return _trackCache.get(id);
  let track;
  const def = TRACK_DEFS.find(d => d.id === id);
  if (def && def.ctrl) track = trackFromControlPoints(def.ctrl, def.id, def.name);
  else if (def) track = generateTrack(def.seed, def.name);
  else if (id.startsWith('proc-')) track = generateTrack(parseInt(id.slice(5), 10));
  else throw new Error('Pista sconosciuta: ' + id);
  track.role = def ? def.role : 'random';
  _trackCache.set(id, track);
  // Le piste casuali generate al volo non servono per sempre
  if (_trackCache.size > 40) {
    for (const key of _trackCache.keys()) {
      if (!TRACK_DEFS.some(d => d.id === key)) { _trackCache.delete(key); break; }
    }
  }
  return track;
}

const trainTrackIds = () => TRACK_DEFS.filter(d => d.role === 'train').map(d => d.id);
const testTrackIds = () => TRACK_DEFS.filter(d => d.role === 'test').map(d => d.id);
