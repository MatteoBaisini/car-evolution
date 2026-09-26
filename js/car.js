// ============================================================
// CAR.JS — La monoposto: dinamica del veicolo
// ============================================================
//
// COMANDI (analogici, come volante e pedali):
//   throttle ∈ [-1, 1]   +1 = gas a fondo, −1 = freno a fondo
//   steer    ∈ [-1, 1]   −1 = tutto a sinistra, +1 = tutto a destra
//
// MODELLO "A BICICLETTA" (cinematico + limite di aderenza)
// Le due ruote anteriori sono una sola ruota che sterza di δ, le
// posteriori una sola ruota fissa, a distanza L (passo). L'auto
// ruota attorno a un centro di curvatura di raggio:
//        R = L / tan(δ)
// quindi la velocita' di imbardata (rotazione) e'  ω = v / R
// e l'accelerazione laterale richiesta e'  a_lat = v² / R.
//
// Se a_lat supera quello che le gomme possono dare (cerchio di
// aderenza, vedi physics.js) l'auto SOTTOSTERZA: ruota meno di
// quanto vorrebbe, allarga la traiettoria e le gomme strisciano
// (perdono velocita', si scaldano, si consumano).
//
// Freni e acceleratore passano per ABS e controllo di trazione:
// la richiesta longitudinale viene limitata al grip disponibile.
// Ma il grip speso per frenare NON e' piu' disponibile per curvare:
// → bisogna frenare PRIMA della curva, non dentro.
//
// ATTENZIONE al sistema di coordinate del canvas:
//   l'asse Y va verso il BASSO, quindi un angolo che cresce
//   ruota in senso ORARIO sullo schermo (= verso destra).
//
// STATO dell'auto (status):
//   'running'  → in corsa
//   'finished' → ha completato tutti i giri della gara
//   'crashed'  → ha toccato un muro
//   'stalled'  → nessun progresso per troppo tempo
//   'timeout'  → la gara e' finita mentre era ancora in corsa
// ============================================================

const STALL_LIMIT = 180;   // frame senza passare un gate → eliminata (3 s)
const TEL_EVERY = 3;       // un campione di telemetria ogni 3 frame (20 Hz)

// Telemetria: ogni campione e' un blocco di TEL_STRIDE numeri
const TEL = { x: 0, y: 1, h: 2, kmh: 3, thr: 4, brk: 5, steer: 6, glat: 7, glong: 8, use: 9, dist: 10, temp: 11, wear: 12 };
const TEL_STRIDE = 13;

class Car {
  /**
   * @param {VehicleModel} model - caratteristiche della vettura (setup)
   */
  constructor(x, y, heading, model) {
    this.x = x;                 // [px]
    this.y = y;                 // [px]
    this.heading = heading;     // [rad]
    this.v = 0;                 // velocita' [m/s]
    this.steer = 0;             // angolo reale delle ruote [rad]
    this.model = model;

    // Dimensioni di disegno/collisione [px] (24 px ≈ 4.8 m)
    this.length = 24;
    this.width = 11;

    this.status = 'running';

    // --- Gomme ---
    this.tyreTemp = 70;         // [°C] partono dalle termocoperte, un po' fredde
    this.tyreWear = 0;          // 0 = nuove, 1 = finite

    // --- Stato dinamico (per sensori, telemetria, pannelli) ---
    this.throttle = 0;
    this.gLat = 0;              // accelerazione laterale [g]
    this.gLong = 0;             // accelerazione longitudinale [g]
    this.gripUsage = 0;         // richiesta / disponibile (>1 = oltre il limite)
    this.sliding = 0;           // quanto sta strisciando (0 = niente)
    this.onGrass = false;
    this.slipstream = 0;        // 0..1: quanto e' nella scia di un'altra auto
    this.frame = null;          // posizione rispetto alla pista (Track.frameAt)

    // --- Progressi ---
    this.nextGate = 1;          // indice del prossimo gate
    this.gatesPassed = 0;       // gate passati in tutta la gara
    this.framesSinceGate = 0;
    this.age = 0;               // frame di gara
    this.finishFrame = null;

    // --- Cronometro ---
    this.lapStartFrame = 0;
    this.sectorStartFrame = 0;
    this.currentSectors = [];   // tempi dei settori del giro in corso [frame]
    this.laps = [];             // [{ time, sectors: [s1,s2,s3], telStart, telEnd }]

    // --- Statistiche ---
    this.distance = 0;          // [m]
    this.topSpeed = 0;          // [m/s]
    this.grassFrames = 0;
    this.slideFrames = 0;
    this.contacts = 0;
    this.tel = [];              // telemetria (piatta, TEL_STRIDE numeri per campione)
  }

  get alive() { return this.status === 'running'; }
  get kmh() { return toKmh(this.v); }

  /**
   * Un frame di dinamica.
   * @param {{throttle:number, steer:number}} controls
   * @param {Track} track
   */
  update(controls, track) {
    if (!this.alive) return;
    const m = this.model;
    const throttle = clamp(controls.throttle, -1, 1);
    this.throttle = throttle;

    // ---------- 1. Sterzo: le ruote non girano istantaneamente ----------
    const target = clamp(controls.steer, -1, 1) * m.maxSteer;
    const maxStep = m.steerRate * DT;
    this.steer += clamp(target - this.steer, -maxStep, maxStep);

    // ---------- 2. Superficie: asfalto o erba? ----------
    this.frame = track.frameAt(this.x, this.y, this.nextGate - 1);
    this.onGrass = Math.abs(this.frame.offset) > track.halfWidth;
    const surfaceMu = this.onGrass ? 0.55 : 1;
    const rollRes = this.onGrass ? 4.0 : m.rollRes;

    // ---------- 3. Aderenza disponibile ----------
    const tyreMu = tyreTempFactor(this.tyreTemp) * tyreWearFactor(this.tyreWear);
    const A = m.grip(this.v, surfaceMu * tyreMu);
    this.gripAvail = A / G_ACC;                        // [g] per il cerchio di aderenza

    // ---------- 4. Richieste longitudinale e laterale ----------
    const aLatDemand = (this.v * this.v * Math.tan(this.steer)) / m.wheelbase;

    let aLong;
    if (throttle >= 0) {
      // CONTROLLO DI TRAZIONE: il motore puo' usare solo il grip che la
      // curva lascia libero (in uscita di curva si da' gas gradualmente).
      const tractionAvail = Math.sqrt(Math.max(0, A * A - aLatDemand * aLatDemand));
      aLong = Math.min(throttle * m.engineAccel(this.v), tractionAvail);
    } else {
      // ABS: la frenata ha la precedenza (fino al limite del grip)...
      // ...e quello che usa non e' piu' disponibile per curvare.
      aLong = this.v > 0 ? Math.max(throttle * m.brakeMax, -A) : 0;
    }
    const latAvail = Math.sqrt(Math.max(0, A * A - aLong * aLong));   // cerchio di aderenza
    let aLat = aLatDemand;
    this.sliding = 0;
    if (Math.abs(aLatDemand) > latAvail) {
      // SOTTOSTERZO: le gomme danno solo latAvail, il resto e' strisciamento
      this.sliding = (Math.abs(aLatDemand) - latAvail) / A;
      aLat = Math.sign(aLatDemand) * latAvail;
    }
    this.gripUsage = Math.hypot(aLatDemand, aLong) / A;

    // ---------- 5. Resistenze (la scia riduce il drag fino al 40%) ----------
    const resist = m.resistance(this.v, 1 - 0.4 * this.slipstream, rollRes);
    const slide = Math.min(this.sliding, 1);
    const scrub = slide * 6;                           // gomme che strisciano frenano
    const netLong = aLong - resist - scrub;
    this.v = Math.max(0, this.v + netLong * DT);

    // ---------- 6. Imbardata e movimento ----------
    if (this.v > 0.1) this.heading += (aLat / this.v) * DT;
    this.x += Math.cos(this.heading) * this.v * DT * PX_PER_M;
    this.y += Math.sin(this.heading) * this.v * DT * PX_PER_M;

    // ---------- 7. Gomme: temperatura e usura ----------
    // Si scaldano lavorando (e molto strisciando), si raffreddano verso ~30 °C.
    // Equilibrio: 30 + 80·uso  →  uso 0.7 ≈ 86 °C, al limite ≈ 110 °C.
    const work = Math.min(this.gripUsage, 1.2);
    this.tyreTemp += (16 * work + 25 * slide - 0.2 * (this.tyreTemp - 30)) * DT;
    this.tyreWear = Math.min(1, this.tyreWear + m.compound.wear * (0.006 * work * work + 0.03 * slide) * DT);

    // ---------- 8. Registro ----------
    this.gLat = aLat / G_ACC;
    this.gLong = netLong / G_ACC;
    this.age++;
    this.distance += this.v * DT;
    this.topSpeed = Math.max(this.topSpeed, this.v);
    if (this.onGrass) this.grassFrames++;
    if (this.sliding > 0.02) this.slideFrames++;
    if (this.age % TEL_EVERY === 0) this._recordTelemetry(track);
  }

  _recordTelemetry(track) {
    const lapDist = (this.progressGates(track) % track.gates.length) / track.gates.length;
    this.tel.push(this.x, this.y, this.heading, this.kmh,
      Math.max(0, this.throttle), Math.max(0, -this.throttle), this.steer / this.model.maxSteer,
      this.gLat, this.gLong, this.gripUsage, lapDist, this.tyreTemp, this.tyreWear);
  }

  /** I 4 angoli dell'auto (ruotati). Servono per le collisioni. */
  corners() {
    const cos = Math.cos(this.heading), sin = Math.sin(this.heading);
    const hl = this.length / 2, hw = this.width / 2;
    return [[hl, hw], [hl, -hw], [-hl, -hw], [-hl, hw]].map(([lx, ly]) => ({
      x: this.x + lx * cos - ly * sin,
      y: this.y + lx * sin + ly * cos
    }));
  }

  /**
   * Controlla muri, gate, settori e traguardo. Da chiamare dopo update().
   * @param {Track} track
   * @param {{x:number,y:number}} prevPos - posizione prima di update()
   * @param {number} laps - giri della gara
   */
  checkTrack(track, prevPos, laps) {
    if (!this.alive) return;

    // --- Collisione: un lato dell'auto incrocia un muro? ---
    const c = this.corners();
    const near = track.wallsNear(
      Math.min(c[0].x, c[1].x, c[2].x, c[3].x), Math.min(c[0].y, c[1].y, c[2].y, c[3].y),
      Math.max(c[0].x, c[1].x, c[2].x, c[3].x), Math.max(c[0].y, c[1].y, c[2].y, c[3].y));
    for (let i = 0; i < 4; i++) {
      const p1 = c[i], p2 = c[(i + 1) % 4];
      for (const wall of near) {
        if (segmentIntersection(p1, p2, wall.a, wall.b) !== null) {
          this.status = 'crashed';
          return;
        }
      }
    }

    // --- Gate: il movimento di questo frame ha attraversato il prossimo? ---
    const gateIdx = this.nextGate;
    const gate = track.gates[gateIdx];
    if (segmentIntersection(prevPos, this, gate.a, gate.b) !== null) {
      this.gatesPassed++;
      this.nextGate = (gateIdx + 1) % track.gates.length;
      this.framesSinceGate = 0;

      // Settori e giri
      if (gateIdx === track.sectorGates[0] || gateIdx === track.sectorGates[1]) {
        this.currentSectors.push(this.age - this.sectorStartFrame);
        this.sectorStartFrame = this.age;
      } else if (gateIdx === 0) {
        this.currentSectors.push(this.age - this.sectorStartFrame);
        const telStart = this.laps.length ? this.laps[this.laps.length - 1].telEnd : 0;
        this.laps.push({
          time: this.age - this.lapStartFrame,
          sectors: this.currentSectors,
          telStart,
          telEnd: this.tel.length
        });
        this.currentSectors = [];
        this.lapStartFrame = this.age;
        this.sectorStartFrame = this.age;

        if (this.laps.length >= laps) {
          this.status = 'finished';
          this.finishFrame = this.age;
          return;
        }
      }
    } else {
      this.framesSinceGate++;
    }

    if (this.framesSinceGate > STALL_LIMIT) this.status = 'stalled';
  }

  /** Gate passati + frazione verso il prossimo (numero continuo). */
  progressGates(track) {
    const pts = track.centerPoints;
    const n = pts.length;
    const target = pts[this.nextGate];
    const from = pts[(this.nextGate - 1 + n) % n];
    const segLen = Math.hypot(target.x - from.x, target.y - from.y);
    const distLeft = Math.hypot(target.x - this.x, target.y - this.y);
    return this.gatesPassed + clamp(1 - distLeft / segLen, 0, 1);
  }

  /** Progresso nella gara, in GIRI (es. 1.5 = un giro e mezzo). */
  progressLaps(track, laps) {
    if (this.status === 'finished') return laps;
    return Math.min(laps, this.progressGates(track) / track.gates.length);
  }

  /**
   * FITNESS: il "voto" dell'auto. E' l'UNICA cosa che l'algoritmo
   * genetico guarda per decidere chi si riproduce.
   * Si misura in GIRI, cosi' e' confrontabile tra piste diverse.
   *
   *   non arrivata → fitness = giri percorsi               (0 ... L)
   *   arrivata     → fitness = L + L·(1 − t/tMax)          (L ... 2L)
   *
   * Qualunque auto arrivata batte qualunque auto non arrivata;
   * tra le arrivate vince la piu' veloce.
   */
  fitness(track, laps, maxFrames) {
    if (this.status !== 'finished') return this.progressLaps(track, laps);
    return laps + laps * (1 - this.finishFrame / maxFrames);
  }

  /** Il giro piu' veloce completato (o null). */
  bestLap() {
    let best = null;
    for (const lap of this.laps) if (!best || lap.time < best.time) best = lap;
    return best;
  }

  /**
   * Disegna la monoposto: telaio, ali, ruote (le anteriori sterzano!).
   * Trucco: spostiamo e ruotiamo il canvas, cosi' disegniamo "dritto".
   */
  draw(ctx, color = '#3498db', alpha = 1) {
    const body = this.alive || this.status === 'finished' ? color : '#777';
    Car.drawShape(ctx, this.x, this.y, this.heading, this.steer, body, alpha * (this.alive ? 1 : 0.4));
  }

  /** Disegna una monoposto in una posizione qualsiasi (usato anche per il "fantasma"). */
  static drawShape(ctx, x, y, heading, steer, color, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(heading);
    const L = 24, W = 11;

    // Ruote
    ctx.fillStyle = '#111';
    const wheel = (wx, wy, ang) => {
      ctx.save();
      ctx.translate(wx, wy);
      ctx.rotate(ang);
      ctx.fillRect(-2.6, -1.6, 5.2, 3.2);
      ctx.restore();
    };
    wheel(L * 0.3, -W / 2, steer);
    wheel(L * 0.3, W / 2, steer);
    wheel(-L * 0.3, -W / 2, 0);
    wheel(-L * 0.3, W / 2, 0);

    // Telaio + ali
    ctx.fillStyle = color;
    ctx.fillRect(-L / 2 + 2, -2.5, L - 4, 5);                  // scocca
    ctx.fillRect(L / 2 - 3, -W / 2 + 0.5, 3, W - 1);           // ala anteriore
    ctx.fillRect(-L / 2, -W / 2 + 1.5, 3, W - 3);              // ala posteriore
    ctx.fillRect(-L * 0.15, -3.8, L * 0.35, 7.6);              // pance
    ctx.fillStyle = '#111';
    ctx.beginPath();                                            // abitacolo
    ctx.arc(L * 0.02, 0, 1.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
