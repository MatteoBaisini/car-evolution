// ============================================================
// UTIL.JS — Unita' di misura e piccoli strumenti matematici
// ============================================================
//
// UNITA' DI MISURA
// La fisica lavora in unita' SI (metri, secondi, m/s, m/s²),
// come in un vero software di simulazione. Il canvas invece
// lavora in pixel. Il ponte tra i due mondi:
//
//   1 metro = PX_PER_M pixel      (l'auto: 24 px = 4.8 m)
//   1 frame = 1/60 s              (DT)
//
// Esempio: 50 m/s = 180 km/h → in un frame l'auto percorre
//   50 · (1/60) · 5 = 4.17 pixel
// ============================================================

const FPS = 60;              // frame di simulazione al secondo "simulato"
const DT = 1 / FPS;          // passo temporale [s]
const PX_PER_M = 5;          // scala del disegno [px/m]
const G_ACC = 9.81;          // accelerazione di gravita' [m/s²]

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const toKmh = ms => ms * 3.6;

/** Differenza tra due angoli, riportata in [-π, π]. */
function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/** Frame → "12.34 s" (o "—" se nullo). */
function fmtTime(frames) {
  return frames === null || frames === undefined ? '—' : (frames / FPS).toFixed(2) + ' s';
}

/**
 * Generatore di numeri casuali CON SEED (mulberry32).
 * Stesso seed → stessa sequenza di numeri. Serve per generare
 * piste "casuali" ma riproducibili: la pista 4242 e' sempre la stessa.
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
