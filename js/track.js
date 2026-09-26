// ============================================================
// TRACK.JS — La pista
// ============================================================
//
// CONCETTO:
// La pista e' definita da una lista di punti "centrali" — come
// lo scheletro/centro della strada. Immagina di camminare lungo
// il centro di una strada e segnare un punto ogni 10 metri.
//
// Per trasformare questa linea in una strada con larghezza,
// per ogni punto:
//   1. Calcoliamo la DIREZIONE locale (verso dove va la strada)
//   2. Ruotiamo di 90 gradi per ottenere la NORMALE (perpendicolare)
//   3. Ci spostiamo di +halfWidth lungo la normale → bordo esterno
//      e di -halfWidth → bordo interno
//
// Visualizzazione:
//
//       bordo esterno
//   ●━━━━━━━━━━━━━━━━━●
//   |                  |   ↑ halfWidth
//   ○────────────────→ ○   ← centro (direzione →, normale ↑)
//   |                  |   ↓ halfWidth
//   ●━━━━━━━━━━━━━━━━━●
//       bordo interno
//
// Sezione trasversale completa (come un circuito vero):
//
//   MURO | erba | ASFALTO | ASFALTO | erba | MURO
//        |←run→|←──── 2·halfWidth ───→|←run→|
//
// Sull'erba si puo' andare (lentamente e con poco grip),
// contro il muro no.
// ============================================================

class Track {
  /**
   * @param {Array<{x:number,y:number}>} centerPoints - punti centrali della pista
   * @param {object} opts - { id, name, halfWidth (asfalto, px), runoff (erba, px) }
   */
  constructor(centerPoints, opts = {}) {
    this.id = opts.id || 'pista';
    this.name = opts.name || 'Pista';
    this.centerPoints = centerPoints;
    this.halfWidth = opts.halfWidth ?? 32;
    this.runoff = opts.runoff ?? 12;

    // Bordi dell'ASFALTO (il tuo codice dei TODO 1-3)
    this.outerPoints = [];
    this.innerPoints = [];
    this._computeBorders();

    // MURI: stessa matematica, ma piu' in la' (asfalto + erba)
    const wallOffset = this.halfWidth + this.runoff;
    this.wallOuter = this._offsetPoints(+wallOffset);
    this.wallInner = this._offsetPoints(-wallOffset);

    // Segmenti: muri (collisioni) e bordi asfalto (sensori)
    this.borders = [...this._segmentsOf(this.wallOuter), ...this._segmentsOf(this.wallInner)];
    this.edges = [...this._segmentsOf(this.outerPoints), ...this._segmentsOf(this.innerPoints)];

    // GATE (checkpoint): da muro a muro, cosi' valgono anche passando sull'erba.
    // Attraversarli in ordine = fare progressi → e' la base della fitness.
    this.gates = this.wallInner.map((p, i) => ({ a: p, b: this.wallOuter[i] }));

    // SETTORI: il giro e' diviso in 3 parti, come in F1.
    const G = this.gates.length;
    this.sectorGates = [Math.round(G / 3), Math.round((2 * G) / 3)];

    this._computeGeometry();
    this.wallGrid = this._buildGrid(this.borders, 80);
    this.edgeGrid = this._buildGrid(this.edges, 80);
  }

  /**
   * Per ogni punto centrale, calcola il corrispondente punto sul
   * bordo esterno e sul bordo interno.
   */
  _computeBorders() {
    const pts = this.centerPoints;
    const n = pts.length;

    for (let i = 0; i < n; i++) {
      const curr = pts[i];

      // Per avere una direzione "smooth", guardiamo il punto
      // PRECEDENTE e il punto SUCCESSIVO (non solo il successivo).
      // Il modulo (% n) ci permette di "avvolgere" — l'ultimo
      // punto guarda verso il primo, chiudendo il circuito.
      const prev = pts[(i - 1 + n) % n];
      const next = pts[(i + 1) % n];

      // ==========================================================
      // TODO 1: Calcola la direzione locale della pista
      // ==========================================================
      // La direzione va da `prev` verso `next`.
      // Calcola dx e dy (differenze), poi la lunghezza del vettore
      // (usa Math.hypot), e infine normalizza dividendo per la lunghezza.
      //
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const len = Math.hypot(dx, dy);
      const dirX = dx / len;
      const dirY = dy / len;

      // ==========================================================
      // TODO 2: Calcola la normale (perpendicolare alla direzione)
      // ==========================================================
      // Per ruotare un vettore (x, y) di 90 gradi:
      //   - in senso antiorario: (-y, x)
      //   - in senso orario:    (y, -x)
      //
      // Noi usiamo (-dirY, dirX) che va "a sinistra" della direzione.
      //
      const normX = -dirY;
      const normY = dirX;

      // ==========================================================
      // TODO 3: Calcola i punti sui bordi
      // ==========================================================
      // Il bordo esterno e' il punto centrale + normale * halfWidth
      // Il bordo interno e' il punto centrale - normale * halfWidth
      //
      this.outerPoints.push({ x: curr.x + normX * this.halfWidth, y: curr.y + normY * this.halfWidth });
      this.innerPoints.push({ x: curr.x - normX * this.halfWidth, y: curr.y - normY * this.halfWidth });
    }
  }

  /** Come _computeBorders, ma per una distanza qualsiasi (con segno). */
  _offsetPoints(offset) {
    const pts = this.centerPoints, n = pts.length;
    return pts.map((curr, i) => {
      const prev = pts[(i - 1 + n) % n], next = pts[(i + 1) % n];
      const len = Math.hypot(next.x - prev.x, next.y - prev.y);
      const normX = -(next.y - prev.y) / len, normY = (next.x - prev.x) / len;
      return { x: curr.x + normX * offset, y: curr.y + normY * offset };
    });
  }

  _segmentsOf(points) {
    const n = points.length;
    const segs = [];
    for (let i = 0; i < n; i++) segs.push({ a: points[i], b: points[(i + 1) % n], stamp: 0 });
    return segs;
  }

  // ==========================================================
  // GEOMETRIA: lunghezze, curvatura, raggi (in metri)
  // ==========================================================
  _computeGeometry() {
    const pts = this.centerPoints, n = pts.length;

    // Lunghezza di ogni tratto e distanza progressiva dal via
    this.segLenM = pts.map((p, i) => {
      const q = pts[(i + 1) % n];
      return Math.hypot(q.x - p.x, q.y - p.y) / PX_PER_M;
    });
    this.distM = [];
    let acc = 0;
    for (let i = 0; i < n; i++) { this.distM.push(acc); acc += this.segLenM[i]; }
    this.lengthM = acc;

    // Angolo di svolta in ogni punto (con segno: + = destra sullo schermo)
    this.signedTurn = pts.map((c, i) => {
      const p = pts[(i - 1 + n) % n], q = pts[(i + 1) % n];
      return angleDiff(Math.atan2(q.y - c.y, q.x - c.x), Math.atan2(c.y - p.y, c.x - p.x));
    });
    this.curvature = this.signedTurn.map(Math.abs);

    // Raggio di curvatura: cerchio passante per 3 punti (i-2, i, i+2).
    //   R = (a·b·c) / (4·Area)   (formula del raggio circoscritto)
    this.radiusM = pts.map((b, i) => {
      const a = pts[(i - 2 + n) % n], c = pts[(i + 2) % n];
      const ab = Math.hypot(b.x - a.x, b.y - a.y);
      const bc = Math.hypot(c.x - b.x, c.y - b.y);
      const ca = Math.hypot(a.x - c.x, a.y - c.y);
      const area2 = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
      const Rpx = area2 < 1e-6 ? 1e9 : (ab * bc * ca) / (2 * area2);
      return Math.min(1e4, Rpx / PX_PER_M);
    });
  }

  /**
   * Dove si trova un punto rispetto alla pista.
   * Cerca il tratto di linea centrale piu' vicino (solo attorno a `hint`,
   * per non provarli tutti) e restituisce:
   *   offset: distanza con segno dalla linea centrale [px] (+ = lato "outer")
   *   angle:  direzione della pista in quel punto [rad]
   *   index:  indice del tratto
   */
  frameAt(x, y, hint) {
    const pts = this.centerPoints, n = pts.length;
    let best = null;
    for (let k = -5; k <= 4; k++) {
      const i = (((hint + k) % n) + n) % n;
      const a = pts[i], b = pts[(i + 1) % n];
      const vx = b.x - a.x, vy = b.y - a.y;
      const L2 = vx * vx + vy * vy;
      const t = clamp(((x - a.x) * vx + (y - a.y) * vy) / L2, 0, 1);
      const px = a.x + vx * t, py = a.y + vy * t;
      const d = Math.hypot(x - px, y - py);
      if (!best || d < best.dist) {
        const L = Math.sqrt(L2);
        // proiezione sulla normale (-vy, vx)/L → distanza con segno
        const offset = ((x - px) * -vy + (y - py) * vx) / L;
        best = { dist: d, offset, angle: Math.atan2(vy, vx), index: i, t };
      }
    }
    return best;
  }

  // ==========================================================
  // OTTIMIZZAZIONE: griglia spaziale
  // ==========================================================
  // Con centinaia di segmenti, provare OGNI segmento per OGNI
  // raggio di OGNI auto costa troppo. Dividiamo il canvas in celle
  // quadrate e ricordiamo quali segmenti passano per ogni cella:
  // un raggio tocca poche celle → controlla solo i segmenti vicini.
  // Il risultato e' identico, solo molto piu' veloce.
  // ==========================================================
  _buildGrid(segments, cellSize) {
    const grid = { cellSize, cells: new Map(), stamp: 0 };
    for (const seg of segments) {
      const [x0, y0, x1, y1] = this._cellRange(grid,
        Math.min(seg.a.x, seg.b.x), Math.min(seg.a.y, seg.b.y),
        Math.max(seg.a.x, seg.b.x), Math.max(seg.a.y, seg.b.y));
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const key = cx + ',' + cy;
          if (!grid.cells.has(key)) grid.cells.set(key, []);
          grid.cells.get(key).push(seg);
        }
      }
    }
    return grid;
  }

  _cellRange(grid, minX, minY, maxX, maxY) {
    const s = grid.cellSize;
    return [Math.floor(minX / s), Math.floor(minY / s), Math.floor(maxX / s), Math.floor(maxY / s)];
  }

  _query(grid, minX, minY, maxX, maxY) {
    const stamp = ++grid.stamp;   // per non restituire due volte lo stesso segmento
    const out = [];
    const [x0, y0, x1, y1] = this._cellRange(grid, minX, minY, maxX, maxY);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const cell = grid.cells.get(cx + ',' + cy);
        if (!cell) continue;
        for (const seg of cell) {
          if (seg.stamp !== stamp) { seg.stamp = stamp; out.push(seg); }
        }
      }
    }
    return out;
  }

  /** I muri che potrebbero toccare il rettangolo dato. */
  wallsNear(minX, minY, maxX, maxY) { return this._query(this.wallGrid, minX, minY, maxX, maxY); }

  /** I bordi dell'asfalto che potrebbero toccare il rettangolo dato. */
  edgesNear(minX, minY, maxX, maxY) { return this._query(this.edgeGrid, minX, minY, maxX, maxY); }

  // ==========================================================
  // VALIDAZIONE: la pista e' costruibile?
  // ==========================================================
  // Controlli di un "ingegnere di circuito":
  //  - i muri non si incrociano da nessuna parte
  //  - due tratti non consecutivi sono abbastanza lontani
  //  - le curve hanno raggio > distanza del muro (altrimenti il
  //    muro interno si ripiega su se stesso)
  //  - tutto sta dentro il canvas
  // ==========================================================
  validate(width = 1200, height = 800) {
    const problems = [];
    const off = this.halfWidth + this.runoff;
    const pts = this.centerPoints, n = pts.length;

    let crossings = 0;
    const rings = [this._segmentsOf(this.wallOuter), this._segmentsOf(this.wallInner)];
    for (const s of rings) {
      for (let i = 0; i < s.length; i++) {
        for (let j = i + 2; j < s.length; j++) {
          if (i === 0 && j === s.length - 1) continue;
          if (segmentIntersection(s[i].a, s[i].b, s[j].a, s[j].b) !== null) crossings++;
        }
      }
    }
    for (const a of rings[0]) for (const b of rings[1]) {
      if (segmentIntersection(a.a, a.b, b.a, b.b) !== null) crossings++;
    }
    if (crossings) problems.push(`${crossings} incroci tra i muri`);

    let minGap = Infinity;
    const skip = Math.ceil((off * 3) / 32) + 2;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const k = Math.min(j - i, n - (j - i));
        if (k < skip) continue;
        minGap = Math.min(minGap, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
      }
    }
    if (minGap < 2 * off + 10) problems.push(`tratti troppo vicini (${minGap.toFixed(0)} px)`);

    const minRadiusPx = Math.min(...this.radiusM) * PX_PER_M;
    if (minRadiusPx < off + 4) problems.push(`curva troppo stretta (R = ${minRadiusPx.toFixed(0)} px)`);

    const all = [...this.wallOuter, ...this.wallInner];
    if (all.some(p => p.x < 4 || p.y < 4 || p.x > width - 4 || p.y > height - 4)) problems.push('esce dal canvas');

    return { ok: problems.length === 0, problems, minGapPx: minGap, minRadiusPx };
  }

  /**
   * Il punto del canvas piu' LONTANO dalla pista (dove scrivere le
   * scritte grandi senza coprire le auto). Ricerca su una griglia:
   * per ogni punto, distanza dal punto centrale piu' vicino; teniamo il massimo.
   */
  emptySpot(width = 1200, height = 800) {
    if (this._emptySpot) return this._emptySpot;
    let best = { x: width / 2, y: height / 2, d: 0 };
    for (let x = 60; x < width - 60; x += 20) {
      for (let y = 60; y < height - 60; y += 20) {
        let d = Infinity;
        for (const p of this.centerPoints) d = Math.min(d, Math.hypot(p.x - x, p.y - y));
        if (d > best.d) best = { x, y, d };
      }
    }
    this._emptySpot = best;
    return best;
  }

  // ==========================================================
  // DISEGNO
  // ==========================================================
  draw(ctx) {
    if (this.outerPoints.length === 0) return;

    // Erba (tra i due muri) e asfalto (tra i due bordi), con la regola
    // "evenodd": si colora solo lo spazio TRA i due anelli.
    this._fillRing(ctx, this.wallOuter, this.wallInner, '#243829');
    this._fillRing(ctx, this.outerPoints, this.innerPoints, '#4a4e58');

    // Cordoli in curva, linea bianca sui rettilinei
    this._drawKerb(ctx, this.outerPoints);
    this._drawKerb(ctx, this.innerPoints);

    // Muri (barriere)
    for (const ring of [this.wallOuter, this.wallInner]) {
      ctx.beginPath();
      this._pathThrough(ctx, ring);
      ctx.closePath();
      ctx.strokeStyle = '#8d97a8';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // Linea centrale tratteggiata
    ctx.beginPath();
    this._pathThrough(ctx, this.centerPoints);
    ctx.closePath();
    ctx.setLineDash([10, 10]);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);

    this._drawSectorLines(ctx);
    this._drawStartLine(ctx);
  }

  _fillRing(ctx, ringA, ringB, color) {
    ctx.beginPath();
    this._pathThrough(ctx, ringA);
    ctx.closePath();
    this._pathThrough(ctx, ringB);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill('evenodd');
  }

  /** Linee dei settori (S2 e S3 iniziano qui). */
  _drawSectorLines(ctx) {
    const labels = ['S2', 'S3'];
    this.sectorGates.forEach((g, k) => {
      const a = this.innerPoints[g], b = this.outerPoints[g];
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = 'rgba(181,126,220,0.9)';
      ctx.lineWidth = 3;
      ctx.stroke();
      const w = this.wallInner[g];
      ctx.fillStyle = '#d6b4f0';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(labels[k], w.x + (w.x - b.x) * 0.25, w.y + (w.y - b.y) * 0.25 + 4);
      ctx.textAlign = 'left';
    });
  }

  /**
   * Disegna i gate (checkpoint) con il loro numero.
   * Ogni gate attraversato = un pezzetto di progresso.
   */
  drawGates(ctx) {
    ctx.save();
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = 'rgba(46,204,113,0.35)';
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(46,204,113,0.8)';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    this.gates.forEach((g, i) => {
      ctx.beginPath();
      ctx.moveTo(g.a.x, g.a.y);
      ctx.lineTo(g.b.x, g.b.y);
      ctx.stroke();
      if (i > 0 && i % 5 === 0) {
        // numero (ogni 5 gate) appena fuori dal muro "a"
        const lx = g.a.x + (g.a.x - g.b.x) * 0.15;
        const ly = g.a.y + (g.a.y - g.b.y) * 0.15 + 4;
        ctx.fillText(i, lx, ly);
      }
    });
    ctx.restore();
  }

  /**
   * Scacchiera bianco/nera lungo il gate 0, da bordo a bordo dell'asfalto.
   * u = direzione lungo la linea (attraverso la strada)
   * d = direzione della pista (perpendicolare a u)
   */
  _drawStartLine(ctx) {
    const a = this.innerPoints[0];
    const b = this.outerPoints[0];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    const dx = -uy, dy = ux;

    const cols = 8, rows = 2;
    const s = len / cols;   // lato di un quadretto

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const ox = a.x + ux * c * s + dx * (r - rows / 2) * s;
        const oy = a.y + uy * c * s + dy * (r - rows / 2) * s;
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(ox + ux * s, oy + uy * s);
        ctx.lineTo(ox + ux * s + dx * s, oy + uy * s + dy * s);
        ctx.lineTo(ox + dx * s, oy + dy * s);
        ctx.closePath();
        ctx.fillStyle = (r + c) % 2 === 0 ? '#f5f5f5' : '#111';
        ctx.fill();
      }
    }
  }

  _pathThrough(ctx, points) {
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
  }

  /**
   * Bordo dell'asfalto: cordolo rosso/bianco nelle curve, linea
   * bianca sottile sui rettilinei (come in F1).
   */
  _drawKerb(ctx, points) {
    const n = points.length;
    const colors = ['#e74c3c', '#f5f5f5'];
    const KERB_CURVATURE = 0.09;   // radianti di svolta per punto oltre cui e' "curva"
    for (let i = 0; i < n; i++) {
      const a = points[i];
      const b = points[(i + 1) % n];
      const inCorner = Math.max(this.curvature[i], this.curvature[(i + 1) % n]) > KERB_CURVATURE;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = inCorner ? colors[i % 2] : 'rgba(245,245,245,0.85)';
      ctx.lineWidth = inCorner ? 5 : 2;
      ctx.stroke();
    }
  }
}

// ============================================================
// Intersezione tra due segmenti AB e CD.
//
// Scriviamo i punti dei due segmenti in forma parametrica:
//   P(t) = A + t·(B-A)    con t in [0,1]
//   Q(u) = C + u·(D-C)    con u in [0,1]
// e cerchiamo t, u tali che P(t) = Q(u). Risolvendo il sistema
// col prodotto vettoriale 2D  cross(v,w) = v.x*w.y - v.y*w.x
// si ottengono le formule qui sotto.
//
// Restituisce t (quanto lungo AB e' l'incrocio, 0..1) oppure
// null se i segmenti non si toccano. Il valore t e' comodissimo
// per i sensori: e' gia' la distanza normalizzata!
// ============================================================
function segmentIntersection(A, B, C, D) {
  const rx = B.x - A.x, ry = B.y - A.y;   // r = B - A
  const sx = D.x - C.x, sy = D.y - C.y;   // s = D - C
  const qx = C.x - A.x, qy = C.y - A.y;   // q = C - A

  const denom = rx * sy - ry * sx;        // cross(r, s)
  if (denom === 0) return null;           // paralleli

  const t = (qx * sy - qy * sx) / denom;  // cross(q, s) / cross(r, s)
  const u = (qx * ry - qy * rx) / denom;  // cross(q, r) / cross(r, s)

  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return t;
  return null;
}

// ============================================================
// CURVE MORBIDE: spline di Catmull-Rom
// ============================================================
// Unire i punti con segmenti dritti da' curve "a spigoli".
// Una spline di Catmull-Rom passa ESATTAMENTE per ogni punto di
// controllo, ma tra un punto e l'altro disegna una curva liscia,
// usando anche il punto prima e quello dopo per decidere la
// direzione. Tra P1 e P2 (con vicini P0 e P3), per t da 0 a 1:
//
//   P(t) = 0.5 · ( 2·P1
//                + (−P0 + P2)·t
//                + (2·P0 − 5·P1 + 4·P2 − P3)·t²
//                + (−P0 + 3·P1 − 3·P2 + P3)·t³ )
//
// Chiusa: il punto dopo l'ultimo e' il primo (circuito).
// ============================================================
function catmullRomClosed(ctrl, samplesPerSegment = 20) {
  const n = ctrl.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n], p1 = ctrl[i];
    const p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
    for (let s = 0; s < samplesPerSegment; s++) {
      const t = s / samplesPerSegment, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  return out;
}

// ============================================================
// RICAMPIONAMENTO: punti a distanza costante
// ============================================================
// La spline produce punti fitti nelle curve strette e radi nei
// rettilinei. Noi vogliamo un punto (= un gate) ogni `spacing`
// pixel, cosi' ogni gate vale la stessa quantita' di strada e la
// fitness e' "giusta" ovunque. Camminiamo lungo la linea e
// lasciamo cadere un punto ogni `spacing` pixel.
// ============================================================
function resampleClosed(points, spacing) {
  const n = points.length;
  const out = [{ ...points[0] }];
  let carry = 0;   // strada percorsa dall'ultimo punto lasciato
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    let d = spacing - carry;   // dove cade il prossimo punto su questo segmento
    while (d <= segLen) {
      const t = d / segLen;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      d += spacing;
    }
    carry = segLen - (d - spacing);
  }
  // L'ultimo punto potrebbe cadere quasi sopra al primo: toglilo
  const last = out[out.length - 1];
  if (Math.hypot(last.x - out[0].x, last.y - out[0].y) < spacing * 0.5) out.pop();
  return out;
}
