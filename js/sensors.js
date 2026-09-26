// ============================================================
// SENSORS.JS — Cosa "sente" il pilota (gli ingressi della rete)
// ============================================================
//
// La rete neurale riceve 16 numeri, tutti riportati circa in
// [-1, 1] (le reti lavorano meglio con numeri di questa scala):
//
//  VISTA (7 raggi a ventaglio, S1 = sinistra … S7 = destra)
//    distanza dal bordo dell'ASFALTO: 0 = lontano, 1 = attaccato
//
//  CORPO (quello che un pilota sente dal sedile)
//    vel     velocita' / 90 m/s
//    grip    quanto grip sta usando (1 = al limite)
//
//  CONOSCENZA DEL CIRCUITO (come un pilota che la pista la conosce)
//    curva+  quanto gira la pista nei prossimi ~25 m (+ = destra)
//    curva++ quanto gira tra ~25 e ~75 m
//    g curva quanti g servirebbero per fare la curva piu' stretta
//            nei prossimi 15–75 m ALLA VELOCITA' ATTUALE (v²/R).
//            Se supera il grip disponibile... bisogna frenare!
//    offset  posizione laterale sulla pista (−1 = bordo sx, +1 = bordo dx)
//    angolo  angolo tra auto e pista (0 = allineata)
//
//  GOMME
//    T gom   temperatura rispetto alla finestra ottimale
//    usura   0 = nuove, 1 = finite
//
// FEATURE ENGINEERING: "g curva" non dice alla rete COSA fare,
// ma le da' gia' pronta una grandezza fisica (v²/R) che altrimenti
// dovrebbe "scoprire" moltiplicando velocita' e curvatura. Scegliere
// bene gli ingressi e' spesso la parte piu' importante del ML.
// ============================================================

const INPUT_LABELS = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7',
  'vel', 'grip', 'curva+', 'curva++', 'g curva', 'offset', 'angolo', 'T gom', 'usura'];
const OUTPUT_LABELS = ['gas/freno', 'sterzo'];

class Sensor {
  constructor(rayCount = 7, rayLength = 220, spread = Math.PI * 0.75) {
    this.rayCount = rayCount;
    this.rayLength = rayLength;   // [px] (220 px = 44 m)
    this.spread = spread;         // apertura totale del ventaglio (radianti)
    this.rays = [];               // [{start, end}] per il disegno
    this.readings = [];           // t di ogni raggio (0..1)
  }

  /** Lancia i raggi dalla posizione attuale dell'auto. */
  update(car, track) {
    this.rays = [];
    this.readings = [];

    for (let i = 0; i < this.rayCount; i++) {
      // Distribuisce i raggi uniformemente da -spread/2 a +spread/2
      const frac = this.rayCount === 1 ? 0.5 : i / (this.rayCount - 1);
      const angle = car.heading - this.spread / 2 + frac * this.spread;

      const start = { x: car.x, y: car.y };
      const end = {
        x: car.x + Math.cos(angle) * this.rayLength,
        y: car.y + Math.sin(angle) * this.rayLength
      };

      // Il bordo dell'asfalto piu' vicino lungo questo raggio
      // (solo i segmenti vicini: vedi Track.edgesNear)
      let closest = 1;
      const near = track.edgesNear(
        Math.min(start.x, end.x), Math.min(start.y, end.y),
        Math.max(start.x, end.x), Math.max(start.y, end.y));
      for (const seg of near) {
        const t = segmentIntersection(start, end, seg.a, seg.b);
        if (t !== null && t < closest) closest = t;
      }

      this.rays.push({ start, end });
      this.readings.push(closest);
    }
  }

  draw(ctx) {
    for (let i = 0; i < this.rays.length; i++) {
      const { start, end } = this.rays[i];
      const t = this.readings[i];
      const hit = { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(hit.x, hit.y);
      ctx.strokeStyle = 'rgba(241,196,15,0.7)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (t < 1) {
        ctx.beginPath();
        ctx.arc(hit.x, hit.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#e74c3c';
        ctx.fill();
      }
    }
  }
}

/** Somma delle svolte (con segno) dei punti da `from` a `to` dopo l'indice i. */
function turnAhead(track, i, from, to) {
  const n = track.signedTurn.length;
  let s = 0;
  for (let k = from; k <= to; k++) s += track.signedTurn[(i + k) % n];
  return s;
}

/** Raggio minimo [m] dei punti da `from` a `to` dopo l'indice i. */
function minRadiusAhead(track, i, from, to) {
  const n = track.radiusM.length;
  let r = Infinity;
  for (let k = from; k <= to; k++) r = Math.min(r, track.radiusM[(i + k) % n]);
  return r;
}

/**
 * Costruisce i 16 ingressi della rete per un'auto.
 * Chiama anche sensor.update() (i raggi).
 */
function buildInputs(car, sensor, track) {
  sensor.update(car, track);
  const f = car.frame || track.frameAt(car.x, car.y, car.nextGate - 1);
  const i = car.nextGate;
  const gNeeded = (car.v * car.v) / minRadiusAhead(track, i, 2, 12) / G_ACC;
  return [
    ...sensor.readings.map(t => 1 - t),
    car.v / 90,
    Math.min(car.gripUsage, 1.5) / 1.5,
    clamp(turnAhead(track, i, 0, 3) / 0.8, -1, 1),
    clamp(turnAhead(track, i, 4, 11) / 1.6, -1, 1),
    clamp(gNeeded / 4, 0, 1.5),
    clamp(f.offset / track.halfWidth, -1.5, 1.5) / 1.5,
    clamp(angleDiff(car.heading, f.angle) / (Math.PI / 2), -1, 1),
    clamp((car.tyreTemp - TYRE_OPT_TEMP) / 50, -1, 1),
    car.tyreWear
  ];
}
