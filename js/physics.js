// ============================================================
// PHYSICS.JS — Modello del veicolo (unita' SI)
// ============================================================
//
// Un modello semplificato ma "onesto" di una monoposto:
//
//  1. MOTORE a potenza costante:   a_motore = P / (m · v)
//     A bassa velocita' questa formula darebbe accelerazioni
//     enormi: in pratica il limite e' l'ADERENZA delle gomme
//     (il controllo di trazione taglia la coppia).
//
//  2. RESISTENZA aerodinamica:     a_drag = k_D · v²
//     + resistenza al rotolamento (costante).
//     La velocita' massima nasce da sola: e' quella a cui
//     a_motore = a_drag.
//
//  3. CARICO AERODINAMICO (downforce): le ali "schiacciano"
//     l'auto a terra con una forza che cresce con v²:
//         aderenza = μ · (g + k_L · v²)
//     Per questo una F1 in curva veloce tiene PIU' g che in
//     curva lenta. Ma piu' ala = piu' drag = meno velocita'
//     sul dritto: e' il compromesso classico del setup.
//
//  4. CERCHIO DI ADERENZA: le gomme hanno un "budget" totale
//     di accelerazione. Se lo spendi per frenare, ne resta
//     meno per curvare:  a_lat² + a_long² ≤ aderenza²
//
// Con questo modello si puo' calcolare anche il tempo TEORICO
// sul giro (vedi lapTimeSimulation in fondo).
// ============================================================

const COMPOUNDS = {
  soft:   { label: 'Soft',   mu: 1.75, wear: 2.0,  color: '#e74c3c' },
  medium: { label: 'Medium', mu: 1.60, wear: 1.0,  color: '#f1c40f' },
  hard:   { label: 'Hard',   mu: 1.45, wear: 0.55, color: '#ecf0f1' }
};

const DEFAULT_SETUP = {
  powerKW: 750,       // potenza [kW]  (F1 moderna ≈ 750)
  wing: 0.5,          // incidenza ali: 0 = scarico (Monza), 1 = carico (Monaco)
  compound: 'medium', // mescola gomme
  mass: 800           // massa con pilota [kg]
};

/**
 * Temperatura gomme → fattore di aderenza.
 * Le gomme funzionano bene in una "finestra" attorno ai 95 °C:
 * fredde o surriscaldate perdono fino al 30% di grip.
 */
const TYRE_OPT_TEMP = 95;
function tyreTempFactor(T) {
  const x = (T - TYRE_OPT_TEMP) / 45;
  return 1 - 0.3 * Math.min(1, x * x);
}

/** Usura 0..1 → fattore di aderenza (gomma finita = −35%). */
function tyreWearFactor(W) {
  return 1 - 0.35 * W;
}

class VehicleModel {
  constructor(setup = DEFAULT_SETUP) {
    this.setup = { ...setup };
    this.mass = setup.mass;
    this.power = setup.powerKW * 1000;          // [W]
    this.kDrag = 0.0006 + 0.0009 * setup.wing;  // a_drag = kDrag·v²   [1/m]
    this.kDown = 0.0010 + 0.0045 * setup.wing;  // a_down = kDown·v²   [1/m]
    this.rollRes = 0.15;                        // [m/s²]
    this.brakeMax = 50;                         // richiesta freno massima [m/s²] (poi limita il grip)
    this.wheelbase = 3.6;                       // passo [m]
    this.maxSteer = 0.42;                       // angolo max ruote [rad] (≈ 24°)
    this.steerRate = 2.2;                       // velocita' max di sterzata [rad/s]
    this.compound = COMPOUNDS[setup.compound] || COMPOUNDS.medium;
    this.mu = this.compound.mu;
  }

  /** Accelerazione totale disponibile dalle gomme [m/s²]. */
  grip(v, muFactor = 1) {
    return this.mu * muFactor * (G_ACC + this.kDown * v * v);
  }

  /** Accelerazione massima dal motore (limitata dalla potenza) [m/s²]. */
  engineAccel(v) {
    return this.power / (this.mass * Math.max(v, 5));
  }

  /** Decelerazione dovuta ad aria + rotolamento [m/s²]. */
  resistance(v, dragFactor = 1, rollRes = this.rollRes) {
    return this.kDrag * dragFactor * v * v + rollRes;
  }

  /**
   * Velocita' massima in una curva di raggio R [m].
   * In curva:  v²/R = μ·(g + k_L·v²)   →   v² = μg / (1/R − μ·k_L)
   * Se il denominatore e' ≤ 0 il carico aerodinamico basta a tenere
   * qualsiasi velocita': la curva si fa "in pieno".
   */
  cornerSpeed(R) {
    const d = 1 / R - this.mu * this.kDown;
    return d <= 0 ? Infinity : Math.sqrt((this.mu * G_ACC) / d);
  }

  /** Velocita' di punta: dove motore e resistenze si equilibrano (bisezione). */
  topSpeed() {
    let lo = 1, hi = 200;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (this.engineAccel(mid) > this.resistance(mid)) lo = mid; else hi = mid;
    }
    return lo;
  }

  /** Spazio di frenata da v1 a v2 [m], integrando grip + drag (in rettilineo). */
  brakingDistance(v1, v2) {
    let v = v1, s = 0;
    const h = 0.001;
    while (v > v2) {
      const decel = this.grip(v) + this.resistance(v);
      s += v * h;
      v -= decel * h;
    }
    return s;
  }
}

// ============================================================
// LAP TIME SIMULATION (LTS) — "quasi-statica"
// ============================================================
// E' il metodo che usano davvero i team (nella sua forma base)
// per stimare il tempo sul giro di un setup PRIMA di andare in
// pista. Lungo la linea centrale:
//
//  1. Per ogni punto, velocita' massima in curva: v ≤ cornerSpeed(R)
//  2. Passata IN AVANTI: da ogni punto al successivo si puo'
//     accelerare al massimo di (motore ∧ grip residuo − drag).
//  3. Passata ALL'INDIETRO: arrivando a una curva bisogna aver
//     frenato in tempo: si risale all'indietro con (grip + drag).
//  4. Il profilo di velocita' e' il minimo dei tre vincoli.
//     Tempo = Σ distanza / velocita'.
//
// NB: segue la linea CENTRALE. Un pilota vero (o la nostra IA)
// "taglia" le curve e allarga il raggio → puo' andare piu' forte!
// ============================================================
function lapTimeSimulation(track, model) {
  const n = track.centerPoints.length;
  const R = track.radiusM;
  const ds = track.segLenM;       // ds[i] = distanza da i a i+1 [m]
  const vTop = model.topSpeed();
  const v = R.map(r => Math.min(vTop, model.cornerSpeed(r)));

  const latAcc = (vi, i) => (vi * vi) / R[i];
  const longAvail = (vi, i) => Math.sqrt(Math.max(0, model.grip(vi) ** 2 - latAcc(vi, i) ** 2));

  // Due giri in avanti e due indietro: cosi' il "giro lanciato" si chiude su se stesso
  for (let k = 0; k < 2 * n; k++) {
    const i = k % n, j = (i + 1) % n;
    const a = Math.min(model.engineAccel(v[i]), longAvail(v[i], i)) - model.resistance(v[i]);
    v[j] = Math.min(v[j], Math.sqrt(Math.max(0, v[i] * v[i] + 2 * a * ds[i])));
  }
  for (let k = 2 * n; k > 0; k--) {
    const i = k % n, j = (i - 1 + n) % n;
    const decel = longAvail(v[i], i) + model.resistance(v[i]);
    v[j] = Math.min(v[j], Math.sqrt(v[i] * v[i] + 2 * decel * ds[j]));
  }

  let time = 0;
  for (let i = 0; i < n; i++) time += ds[i] / Math.max(0.5, (v[i] + v[(i + 1) % n]) / 2);
  return { speeds: v, time, length: track.lengthM };
}

const _ltsCache = new Map();
/** LTS con memoria: ricalcola solo se cambiano pista o setup. */
function getLTS(track, setup) {
  const key = track.id + '|' + JSON.stringify(setup);
  if (!_ltsCache.has(key)) _ltsCache.set(key, lapTimeSimulation(track, new VehicleModel(setup)));
  return _ltsCache.get(key);
}
