// ============================================================
// GENETIC.JS — L'apprendimento (neuroevoluzione)
// ============================================================
//
// QUI AVVIENE IL "LEARNING".
//
// Non c'e' un insegnante e non ci sono esempi di guida corretta.
// C'e' solo un voto (la fitness, vedi Car.fitness) e la
// selezione naturale:
//
//   1. POPOLAZIONE: N auto, ognuna con una rete a pesi casuali.
//   2. GARA:        corrono L giri. La generazione finisce quando
//                   tutte sono arrivate o eliminate. Quando la prima
//                   taglia il traguardo, le altre hanno ancora pochi
//                   secondi (come in una gara vera) e poi stop.
//   3. SELEZIONE:   le auto con fitness alta hanno piu' probabilita'
//                   di diventare genitori (torneo).
//   4. CROSSOVER:   la figlia prende ogni peso a caso da uno dei
//                   due genitori → mescola strategie che funzionano.
//   5. MUTAZIONE:   qualche peso viene spostato di poco a caso →
//                   introduce novita' (senza, si ricombina solo
//                   cio' che c'e' gia' e ci si blocca).
//   6. ELITISMO:    le migliori passano identiche alla generazione
//                   successiva → il record non peggiora mai.
//   7. ESAME:       la campionessa viene provata da sola su piste
//                   che non ha MAI visto (misura l'overfitting).
//   → le figlie ripartono dal punto 2.
//
// Il trucco e' che la rete e' solo un array di numeri (genoma).
// L'evoluzione cerca "alla cieca" in quello spazio di numeri,
// ma guidata dalla fitness.
// ============================================================

const GA_CONFIG = {
  populationSize: 150,
  eliteCount: 3,          // quante migliori copiate identiche
  tournamentSize: 6,      // quante "sfidanti" per ogni selezione
  mutationRate: 0.05,     // probabilita' che un singolo peso muti
  mutationStrength: 0.3,  // di quanto (deviazione standard) muta
  laps: 2,                // giri per gara (le gomme si consumano!)
  lapTimeLimit: 60,       // secondi massimi per giro (poi "fuori tempo")
  finishGrace: 4,         // secondi concessi alle altre dopo la prima arrivata
  networkSizes: [INPUT_LABELS.length, 12, OUTPUT_LABELS.length],
  interactions: false,    // scia e contatti tra le auto
  trackMode: 'fixed',     // 'fixed' | 'rotate' | 'random'
  trackId: 'evoluzione',
  setup: { ...DEFAULT_SETUP }
};

const cloneConfig = c => ({ ...c, setup: { ...c.setup }, networkSizes: [...c.networkSizes] });

// ------------------------------------------------------------
// Operatori genetici — le 3 funzioni che fanno "imparare"
// ------------------------------------------------------------

/**
 * SELEZIONE A TORNEO: pesca `k` individui a caso, vince il migliore.
 * Le forti vincono piu' spesso, ma anche una mediocre ogni tanto
 * passa → si mantiene varieta' (diversita' genetica).
 * Piu' k e' grande, piu' la selezione e' "severa".
 */
function tournamentSelect(ranked, k) {
  let best = null;
  for (let i = 0; i < k; i++) {
    const cand = ranked[Math.floor(Math.random() * ranked.length)];
    if (best === null || cand.fitness > best.fitness) best = cand;
  }
  return best;
}

/**
 * CROSSOVER UNIFORME: per ogni gene (peso), lancia una moneta
 * e prendilo dalla madre o dal padre.
 */
function crossover(genomeA, genomeB) {
  return genomeA.map((gene, i) => (Math.random() < 0.5 ? gene : genomeB[i]));
}

/**
 * MUTAZIONE GAUSSIANA: con probabilita' `rate`, ad ogni peso
 * si aggiunge un piccolo rumore casuale (distribuzione normale:
 * spostamenti piccoli frequenti, grandi rari).
 */
function mutate(genome, rate, strength) {
  return genome.map(gene => (Math.random() < rate ? gene + randomGaussian() * strength : gene));
}

/** Numero casuale con distribuzione normale (Box-Muller). */
function randomGaussian() {
  const u = 1 - Math.random(), v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * DIVERSITA' GENETICA: per ogni gene calcola la deviazione standard
 * nella popolazione, poi fa la media.
 *   alta  → le auto sono molto diverse (esplorazione)
 *   bassa → sono quasi tutte cloni (convergenza: rischio di bloccarsi)
 */
function geneticDiversity(genomes) {
  const n = genomes.length, len = genomes[0].length;
  let total = 0;
  for (let g = 0; g < len; g++) {
    let mean = 0;
    for (let i = 0; i < n; i++) mean += genomes[i][g];
    mean /= n;
    let variance = 0;
    for (let i = 0; i < n; i++) variance += (genomes[i][g] - mean) ** 2;
    total += Math.sqrt(variance / n);
  }
  return total / len;
}

/** Un'auto ferma sulla linea di partenza, rivolta verso il gate 1. */
function carOnGrid(track, model) {
  const s = track.centerPoints[0], n = track.centerPoints[1];
  return new Car(s.x, s.y, Math.atan2(n.y - s.y, n.x - s.x), model);
}

// ------------------------------------------------------------
// SoloRun: una sola auto in pista (esame, demo, "guida tu")
// ------------------------------------------------------------
class SoloRun {
  /**
   * @param {object} o - { genome, sizes, track, setup, laps, lapTimeLimit, driver: 'ai'|'human', name }
   */
  constructor(o) {
    this.track = o.track;
    this.laps = o.laps || 1;
    this.model = new VehicleModel(o.setup || DEFAULT_SETUP);
    this.brain = new NeuralNetwork(o.sizes);
    if (o.genome) this.brain.setGenome(o.genome);
    this.driver = o.driver || 'ai';
    this.car = carOnGrid(this.track, this.model);
    this.sensor = new Sensor();
    this.agent = {
      car: this.car, sensor: this.sensor, brain: this.brain,
      name: o.name || 'Campione', bornGen: o.bornGen || 0,
      origin: { type: this.driver === 'human' ? 'human' : 'demo' }, lastControls: null
    };
    this.frame = 0;
    this.maxFrames = this.laps * (o.lapTimeLimit || 60) * FPS;
    this.human = { throttle: 0, steer: 0 };
  }

  get done() { return !this.car.alive; }

  step() {
    if (this.done) return;
    const inputs = buildInputs(this.car, this.sensor, this.track);
    const ai = this.brain.controls(inputs);   // anche se guidi tu: cosi' vedi cosa farebbe l'IA
    const controls = this.driver === 'human' ? this.human : ai;
    this.agent.lastControls = controls;
    const prev = { x: this.car.x, y: this.car.y };
    this.car.update(controls, this.track);
    this.car.checkTrack(this.track, prev, this.laps);
    this.frame++;
    if (this.frame >= this.maxFrames && this.car.alive) this.car.status = 'timeout';
  }
}

// ------------------------------------------------------------
// Popolazione: gestisce una generazione e crea la successiva
// ------------------------------------------------------------
class Population {
  constructor(config = cloneConfig(GA_CONFIG)) {
    this.config = config;     // modificabile dall'interfaccia: vale dalla generazione dopo
    this.generation = 1;

    // --- Memoria per le statistiche ---
    this.history = [];        // un record per ogni generazione conclusa
    this.lastRanked = [];     // classifica dell'ultima generazione
    this.events = [];         // diario degli eventi importanti
    this.deaths = [];         // dove si sono fermate le auto (ultime generazioni)
    this.skids = [];          // segni di frenata/erba [x, y, tipo, ...]
    this.records = {};        // trackId → giro record { frames, name, gen, sectors, tel, setup }
    this.bestSectors = {};    // trackId → [s1, s2, s3] migliori di sempre
    this.lastGenBest = null;  // giro migliore dell'ultima generazione (con telemetria)
    this.exams = [];          // risultati dell'esame di generalizzazione
    this.champion = null;     // miglior genoma dell'ultima generazione
    this.bestEverFitness = 0;

    this._log('start', `Generazione 1: ${config.populationSize} auto con cervelli completamente casuali.`);
    this._spawn(null);
  }

  _log(type, text) {
    this.events.unshift({ gen: this.generation, type, text });
    if (this.events.length > 200) this.events.pop();
  }

  /** Su che pista si corre alla generazione `gen`. */
  trackIdForGen(gen) {
    const mode = this.config.trackMode;
    if (mode === 'rotate') {
      const ids = trainTrackIds();
      return ids[(gen - 1) % ids.length];
    }
    if (mode === 'random') return `proc-${100000 + gen * 37}`;   // mai uguali alle piste d'esame
    return this.config.trackId;
  }

  /**
   * Crea gli agenti per la generazione corrente.
   * @param {Array|null} entries - [{genome, name, bornGen, origin}] o null per reti casuali
   */
  _spawn(entries) {
    const prevTrack = this.track;
    this.track = getTrack(this.trackIdForGen(this.generation));
    if (prevTrack && prevTrack.id !== this.track.id) {
      this._log('track', `Si corre su: ${this.track.name} (${Math.round(this.track.lengthM)} m).`);
    }
    // "Fotografia" delle regole di questa gara: cambiarle a meta' gara non la rompe
    this.model = new VehicleModel(this.config.setup);
    this.raceLaps = this.config.laps;
    this.raceMaxFrames = this.config.laps * this.config.lapTimeLimit * FPS;

    const count = entries ? entries.length : this.config.populationSize;
    this.agents = [];
    for (let i = 0; i < count; i++) {
      const brain = new NeuralNetwork(this.config.networkSizes);
      const e = entries ? entries[i] : null;
      if (e) brain.setGenome(e.genome);
      this.agents.push({
        idx: i,
        car: carOnGrid(this.track, this.model),
        sensor: new Sensor(),
        brain,
        name: e ? e.name : `G1#${i + 1}`,
        bornGen: e ? e.bornGen : 1,
        origin: e ? e.origin : { type: 'random' },
        lastControls: null
      });
    }
    this.frame = 0;
    this.firstFinishFrame = null;
    this.skids = [];
  }

  /** Un passo di simulazione (1 frame) per tutte le auto in corsa. */
  step() {
    if (this.config.interactions) this._interactions();

    for (const agent of this.agents) {
      const { car, sensor, brain } = agent;
      if (!car.alive) continue;

      // sensori → rete → comandi → fisica → controllo pista
      const inputs = buildInputs(car, sensor, this.track);
      const controls = brain.controls(inputs);
      agent.lastControls = controls;

      const prev = { x: car.x, y: car.y };
      car.update(controls, this.track);
      car.checkTrack(this.track, prev, this.raceLaps);

      if ((car.sliding > 0.05 || car.onGrass) && car.age % 2 === 0) {
        this.skids.push(car.x, car.y, car.onGrass ? 1 : 0);
      }
      if (car.status === 'crashed' || car.status === 'stalled') {
        this.deaths.push({ x: car.x, y: car.y, gen: this.generation, type: car.status });
      }
      if (car.status === 'finished' && this.firstFinishFrame === null) {
        this.firstFinishFrame = this.frame;
        this._log('finish', `${agent.name} vince la gara: ${this.raceLaps} giri in ${fmtTime(car.finishFrame)}.`);
      }
    }
    if (this.skids.length > 15000) this.skids.splice(0, 3000);

    this.frame++;

    // Fine gara: tempo scaduto, oppure scaduto il "margine" dopo la prima arrivata
    const graceOver = this.firstFinishFrame !== null &&
                      this.frame - this.firstFinishFrame >= this.config.finishGrace * FPS;
    if (graceOver || this.frame >= this.raceMaxFrames) {
      for (const a of this.agents) if (a.car.alive) a.car.status = 'timeout';
    }

    if (this.agents.every(a => !a.car.alive)) this.evolve();
  }

  // ==========================================================
  // INTERAZIONI TRA AUTO: scia (slipstream) e contatti
  // ==========================================================
  // Scia: dietro un'auto l'aria e' "gia' spostata" → meno drag.
  //   Se un'altra auto e' davanti entro 25 m e quasi allineata,
  //   il drag cala fino al 40%.
  // Contatti: se due auto si sovrappongono si spingono via e
  //   perdono velocita'.
  // Per non avere una carambola alla partenza (partono tutte dallo
  // stesso punto!) le interazioni valgono solo dopo i primi gate.
  // Con le interazioni la fitness dipende anche dalle AVVERSARIE:
  // l'evoluzione diventa "competitiva" (e piu' rumorosa).
  // ==========================================================
  _interactions() {
    const cell = 40, grid = new Map();
    const active = [];
    for (const a of this.agents) {
      a.car.slipstream = 0;
      if (!a.car.alive || a.car.gatesPassed < 6) continue;
      active.push(a);
      const key = Math.floor(a.car.x / cell) + ',' + Math.floor(a.car.y / cell);
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(a);
    }
    const SLIP_RANGE = 25 * PX_PER_M, CONTACT = 15;
    for (const a of active) {
      const c = a.car;
      const cos = Math.cos(c.heading), sin = Math.sin(c.heading);
      const gx = Math.floor(c.x / cell), gy = Math.floor(c.y / cell);
      let slip = 0;
      for (let dx = -4; dx <= 4; dx++) {
        for (let dy = -4; dy <= 4; dy++) {
          const list = grid.get((gx + dx) + ',' + (gy + dy));
          if (!list) continue;
          for (const b of list) {
            if (b === a) continue;
            const o = b.car;
            const ox = o.x - c.x, oy = o.y - c.y;
            const along = ox * cos + oy * sin;
            const lat = -ox * sin + oy * cos;
            if (along > 0 && along < SLIP_RANGE && Math.abs(lat) < 9) slip = Math.max(slip, 1 - along / SLIP_RANGE);
            const d = Math.hypot(ox, oy);
            if (d < CONTACT && d > 0.01 && a.idx < b.idx) {
              const push = (CONTACT - d) / 2, nx = ox / d, ny = oy / d;
              c.x -= nx * push; c.y -= ny * push;
              o.x += nx * push; o.y += ny * push;
              c.v *= 0.9; o.v *= 0.9;
              c.contacts++; o.contacts++;
            }
          }
        }
      }
      c.slipstream = slip;
    }
  }

  /** Conteggio auto per stato: { running, finished, crashed, stalled, timeout } */
  counts() {
    const c = { running: 0, finished: 0, crashed: 0, stalled: 0, timeout: 0 };
    for (const a of this.agents) c[a.car.status]++;
    return c;
  }

  /** L'agente in corsa piu' avanti (se non ce ne sono, il migliore in assoluto). */
  leader() {
    let best = null, bestFit = -Infinity, bestRunning = null, bestRunFit = -Infinity;
    for (const a of this.agents) {
      const f = a.car.fitness(this.track, this.raceLaps, this.raceMaxFrames);
      if (f > bestFit) { bestFit = f; best = a; }
      if (a.car.alive && f > bestRunFit) { bestRunFit = f; bestRunning = a; }
    }
    return bestRunning || best;
  }

  /** Classifica live (per la torre dei tempi): in corsa + arrivate, per progresso. */
  standings() {
    return this.agents
      .filter(a => a.car.alive || a.car.status === 'finished')
      .map(a => ({ a, p: a.car.status === 'finished' ? this.raceLaps + 1 - a.car.finishFrame / 1e6 : a.car.progressGates(this.track) / this.track.gates.length }))
      .sort((x, y) => y.p - x.p);
  }

  /** Ricomincia la generazione in corso con gli stessi cervelli (es. dopo aver cambiato setup o pista). */
  restartGeneration() {
    const entries = this.agents.map(a => ({ genome: a.brain.getGenome(), name: a.name, bornGen: a.bornGen, origin: a.origin }));
    this._spawn(entries);
    this._log('reset', 'Generazione ricominciata con le nuove impostazioni (stessi cervelli).');
  }

  /** Riparte da un cervello importato: 1 copia esatta + tante varianti mutate. */
  seedFrom(genome, name) {
    const next = [{ genome: genome.slice(), name, bornGen: this.generation, origin: { type: 'import' } }];
    while (next.length < this.config.populationSize) {
      const child = mutate(genome, 0.15, 0.3);
      next.push({
        genome: child, name: `G${this.generation}#${next.length + 1}`, bornGen: this.generation,
        origin: { type: 'child', mom: name, momRank: 1, dad: name, dadRank: 1,
                  mutations: child.reduce((n, g, i) => n + (g !== genome[i] ? 1 : 0), 0) }
      });
    }
    this._log('import', `Popolazione ripartita da ${name}: 1 copia esatta + ${next.length - 1} varianti mutate.`);
    this._spawn(next);
  }

  /**
   * FINE GENERAZIONE → nuova generazione di figlie.
   * E' qui che la popolazione "impara".
   */
  evolve() {
    const cfg = this.config;
    const track = this.track, L = this.raceLaps, MF = this.raceMaxFrames;
    for (const a of this.agents) if (a.car.alive) a.car.status = 'timeout';

    // ---------- 1. Voto a ciascuna e classifica ----------
    const ranked = this.agents
      .map(a => {
        const c = a.car, bl = c.bestLap();
        return {
          genome: a.brain.getGenome(),
          fitness: c.fitness(track, L, MF),
          progress: c.progressLaps(track, L),
          status: c.status,
          time: c.finishFrame,
          bestLap: bl ? bl.time : null,
          lapsDone: c.laps.length,
          topSpeed: toKmh(c.topSpeed),
          grassPct: c.grassFrames / Math.max(1, c.age),
          slidePct: c.slideFrames / Math.max(1, c.age),
          contacts: c.contacts,
          wear: c.tyreWear,
          name: a.name,
          bornGen: a.bornGen,
          origin: a.origin,
          children: 0,
          _car: c
        };
      })
      .sort((a, b) => b.fitness - a.fitness);
    ranked.forEach((r, i) => (r.rank = i + 1));

    this._updateTiming(ranked);

    // ---------- 2. Elitismo: le migliori passano invariate ----------
    const next = [];
    const eliteCount = Math.min(cfg.eliteCount, ranked.length, cfg.populationSize);
    for (let i = 0; i < eliteCount; i++) {
      next.push({
        genome: ranked[i].genome.slice(),
        name: ranked[i].name,             // stesso individuo: stesso nome
        bornGen: ranked[i].bornGen,
        origin: { type: 'elite', prevRank: i + 1 }
      });
    }

    // ---------- 3. Le altre: selezione + crossover + mutazione ----------
    let totalMutations = 0;
    while (next.length < cfg.populationSize) {
      const mom = tournamentSelect(ranked, cfg.tournamentSize);
      const dad = tournamentSelect(ranked, cfg.tournamentSize);
      mom.children++;
      if (dad !== mom) dad.children++;

      const mixed = crossover(mom.genome, dad.genome);
      const child = mutate(mixed, cfg.mutationRate, cfg.mutationStrength);
      const mutations = child.reduce((n, g, i) => n + (g !== mixed[i] ? 1 : 0), 0);
      totalMutations += mutations;

      next.push({
        genome: child,
        name: `G${this.generation + 1}#${next.length + 1}`,
        bornGen: this.generation + 1,
        origin: { type: 'child', mom: mom.name, momRank: mom.rank, dad: dad.name, dadRank: dad.rank, mutations }
      });
    }

    // ---------- 4. Esame di generalizzazione della campionessa ----------
    this.champion = {
      genome: ranked[0].genome.slice(), name: ranked[0].name, gen: this.generation,
      trackId: track.id, fitness: ranked[0].fitness, sizes: [...cfg.networkSizes], setup: { ...cfg.setup }
    };
    this._runExam(ranked[0]);

    // ---------- 5. Statistiche (solo per capire, non servono all'algoritmo) ----------
    this._recordStats(ranked, totalMutations / Math.max(1, next.length - eliteCount));

    // ---------- 6. Le figlie ripartono ----------
    this.generation++;
    this.deaths = this.deaths.filter(d => d.gen > this.generation - 6);
    this._spawn(next);
  }

  /** Giri record, migliori settori, giro migliore della generazione. */
  _updateTiming(ranked) {
    const id = this.track.id;
    const bs = this.bestSectors[id] || (this.bestSectors[id] = [null, null, null]);
    let genBest = null;
    for (const r of ranked) {
      const c = r._car;
      c.laps.forEach((lap, k) => {
        lap.sectors.forEach((s, j) => { if (bs[j] === null || s < bs[j]) bs[j] = s; });
        if (!genBest || lap.time < genBest.frames) {
          genBest = { frames: lap.time, name: r.name, lapNo: k + 1, sectors: lap.sectors, tel: c.tel.slice(lap.telStart, lap.telEnd) };
        }
      });
    }
    this.lastGenBest = genBest ? { ...genBest, trackId: id, gen: this.generation } : null;

    const rec = this.records[id];
    if (genBest && (!rec || genBest.frames < rec.frames)) {
      const gain = rec ? ` (−${((rec.frames - genBest.frames) / FPS).toFixed(2)} s)` : '';
      this.records[id] = { ...genBest, trackId: id, gen: this.generation, setup: { ...this.config.setup } };
      this._log('record', `Record sul giro a ${this.track.name}: ${fmtTime(genBest.frames)} di ${genBest.name} (giro ${genBest.lapNo})${gain}.`);
    }
  }

  /**
   * ESAME: la campionessa corre DA SOLA un giro sulla pista di allenamento
   * e su ogni pista d'esame (mai vista). Confrontando i risultati si vede
   * se ha imparato a guidare o solo a memoria questo circuito.
   */
  _runExam(best) {
    const evalOn = id => {
      const run = new SoloRun({
        genome: best.genome, sizes: this.config.networkSizes, track: getTrack(id),
        setup: this.config.setup, laps: 1, lapTimeLimit: this.config.lapTimeLimit
      });
      while (!run.done) run.step();
      return {
        id, name: run.track.name, status: run.car.status,
        progress: run.car.progressLaps(run.track, 1), time: run.car.finishFrame
      };
    };
    const train = evalOn(this.track.id);
    const tests = testTrackIds().map(evalOn);
    this.exams.push({
      gen: this.generation, name: best.name, trackId: this.track.id, train, tests,
      testAvg: tests.reduce((s, t) => s + t.progress, 0) / tests.length
    });
  }

  _recordStats(ranked, avgMutations) {
    const fits = ranked.map(r => r.fitness);
    const finishers = ranked.filter(r => r.status === 'finished');
    const count = s => ranked.filter(r => r.status === s).length;
    const lapTimes = ranked.filter(r => r.bestLap !== null).map(r => r.bestLap);
    const champ = ranked[0];

    const stats = {
      gen: this.generation,
      trackId: this.track.id,
      trackName: this.track.name,
      laps: this.raceLaps,
      best: fits[0],
      avg: fits.reduce((s, f) => s + f, 0) / fits.length,
      median: fits[Math.floor(fits.length / 2)],
      worst: fits[fits.length - 1],
      finished: finishers.length,
      crashed: count('crashed'),
      stalled: count('stalled'),
      timeout: count('timeout'),
      total: ranked.length,
      bestLap: lapTimes.length ? Math.min(...lapTimes) : null,
      raceTime: finishers.length ? Math.min(...finishers.map(r => r.time)) : null,
      lapCompleters: lapTimes.length,
      diversity: geneticDiversity(ranked.map(r => r.genome)),
      avgMutations,
      parents: ranked.filter(r => r.children > 0).length,
      champTopSpeed: champ.topSpeed,
      champGrass: champ.grassPct,
      champSlide: champ.slidePct,
      champWear: champ.wear,
      contacts: ranked.reduce((s, r) => s + r.contacts, 0),
      fitnesses: fits
    };
    this.history.push(stats);

    if (finishers.length && this.history.filter(h => h.finished > 0).length === 1) {
      this._log('milestone', `Prima generazione con auto al traguardo: ${finishers.length} su ${ranked.length}!`);
    }
    if (stats.best > this.bestEverFitness + 1e-9) {
      if (!finishers.length) {
        this._log('progress', `Nuova fitness massima: ${stats.best.toFixed(2)} giri percorsi.`);
      }
      this.bestEverFitness = stats.best;
    }
    this._log('gen', `Gen ${this.generation} (${this.track.name}): ${stats.finished} arrivate, ${stats.crashed} a muro, ` +
      `${stats.stalled} bloccate, ${stats.timeout} fuori tempo. Genitori usati: ${stats.parents}.`);

    // Per la classifica non servono genomi e auto: liberiamo memoria
    this.lastRanked = ranked.map(({ genome, _car, ...rest }) => rest);
  }
}
