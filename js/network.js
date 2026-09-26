// ============================================================
// NETWORK.JS — Il "cervello": una rete neurale feed-forward
// ============================================================
//
// CONCETTO:
// La rete e' una funzione  numeri in ingresso → numeri in uscita.
//
//   INPUT (16)                 HIDDEN (12)        OUTPUT (2)
//   raggi, velocita', grip,    ──────────→        gas/freno  [-1, 1]
//   curve in arrivo, gomme…                       sterzo     [-1, 1]
//
// Ogni neurone fa sempre la stessa cosa:
//   out = tanh( w1*x1 + w2*x2 + ... + wn*xn + bias )
//
//  - i PESI (w) dicono quanto conta ogni ingresso (anche negativo)
//  - il BIAS sposta la soglia
//  - tanh schiaccia il risultato tra -1 e +1: perfetto per
//    comandi analogici come pedali e volante
//
// TUTTO quello che l'auto "sa" sta nei pesi e nei bias
// (16·12+12 + 12·2+2 = 230 numeri).
// La rete qui NON impara da sola (niente backpropagation):
// i pesi vengono scelti dall'evoluzione (vedi genetic.js).
//
// Per l'algoritmo genetico la rete e' solo un GENOMA: la lista
// piatta di tutti i pesi e bias. getGenome/setGenome convertono
// avanti e indietro.
// ============================================================

class Layer {
  constructor(inputCount, outputCount) {
    this.inputCount = inputCount;
    this.outputCount = outputCount;

    // weights[o][i] = peso dalla i-esima entrata all'o-esima uscita
    //
    // INIZIALIZZAZIONE DI XAVIER: pesi casuali in ±sqrt(6 / (in + out)).
    // Con 16 ingressi e pesi in ±1, la somma sarebbe spesso grande e
    // tanh "satura" a ±1: la rete partirebbe con comandi tutto-o-niente.
    // Scalando i pesi, i neuroni partono nella zona "lineare" di tanh.
    if (Layer.xavier === undefined) Layer.xavier = true;
    const limit = Layer.xavier ? Math.sqrt(6 / (inputCount + outputCount)) : 1;
    this.weights = [];
    this.biases = [];
    for (let o = 0; o < outputCount; o++) {
      const row = [];
      for (let i = 0; i < inputCount; i++) row.push((Math.random() * 2 - 1) * limit);
      this.weights.push(row);
      this.biases.push((Math.random() * 2 - 1) * limit);
    }
  }

  feedForward(inputs) {
    const outputs = [];
    for (let o = 0; o < this.outputCount; o++) {
      let sum = this.biases[o];
      const w = this.weights[o];
      for (let i = 0; i < this.inputCount; i++) sum += w[i] * inputs[i];
      outputs.push(Math.tanh(sum));
    }
    return outputs;
  }
}

class NeuralNetwork {
  /** @param {number[]} sizes - neuroni per strato, es. [16, 12, 2] */
  constructor(sizes) {
    this.sizes = sizes;
    this.layers = [];
    for (let l = 0; l < sizes.length - 1; l++) {
      this.layers.push(new Layer(sizes[l], sizes[l + 1]));
    }
    this.lastOutputs = [];   // [input, hidden..., output] per il disegno
  }

  feedForward(inputs) {
    this.lastOutputs = [inputs];
    let values = inputs;
    for (const layer of this.layers) {
      values = layer.feedForward(values);
      this.lastOutputs.push(values);
    }
    return values;
  }

  /** Uscite della rete → comandi analogici per l'auto. */
  controls(inputs) {
    const out = this.feedForward(inputs);
    return { throttle: out[0], steer: out[1] };
  }

  /** Quanti numeri compongono il genoma. */
  static genomeLength(sizes) {
    let n = 0;
    for (let l = 0; l < sizes.length - 1; l++) n += sizes[l] * sizes[l + 1] + sizes[l + 1];
    return n;
  }

  /** Tutti i pesi e bias in un unico array piatto (il "DNA"). */
  getGenome() {
    const genome = [];
    for (const layer of this.layers) {
      for (let o = 0; o < layer.outputCount; o++) {
        genome.push(...layer.weights[o], layer.biases[o]);
      }
    }
    return genome;
  }

  /** Operazione inversa: rimette i numeri del genoma nella rete. */
  setGenome(genome) {
    let k = 0;
    for (const layer of this.layers) {
      for (let o = 0; o < layer.outputCount; o++) {
        for (let i = 0; i < layer.inputCount; i++) layer.weights[o][i] = genome[k++];
        layer.biases[o] = genome[k++];
      }
    }
  }

  /**
   * Disegna la rete: linee blu = pesi positivi, rosse = negativi,
   * spessore = intensita'. Neuroni: giallo = attivo positivo,
   * azzurro = attivo negativo, grigio = spento.
   */
  draw(ctx, x, y, w, h, inLabels = [], outLabels = []) {
    const cols = this.sizes.length;
    const pos = (l, n) => ({
      x: x + (cols === 1 ? w / 2 : (l / (cols - 1)) * w),
      y: y + ((n + 0.5) / this.sizes[l]) * h
    });

    this.layers.forEach((layer, l) => {
      for (let o = 0; o < layer.outputCount; o++) {
        for (let i = 0; i < layer.inputCount; i++) {
          const wgt = layer.weights[o][i];
          const a = pos(l, i), b = pos(l + 1, o);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = wgt > 0 ? 'rgba(52,152,219,0.55)' : 'rgba(231,76,60,0.55)';
          ctx.lineWidth = Math.min(3, Math.abs(wgt) * 1.2);
          ctx.stroke();
        }
      }
    });

    this.sizes.forEach((size, l) => {
      for (let n = 0; n < size; n++) {
        const p = pos(l, n);
        const v = this.lastOutputs[l] ? this.lastOutputs[l][n] : 0;
        const a = Math.min(1, Math.abs(v));
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = a < 0.05 ? '#333' : v > 0 ? `rgba(241,196,15,${0.2 + 0.8 * a})` : `rgba(93,173,226,${0.2 + 0.8 * a})`;
        ctx.fill();
        ctx.strokeStyle = '#ccc';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = '#ddd';
        ctx.font = '11px sans-serif';
        if (l === cols - 1 && outLabels[n]) {
          ctx.fillText(outLabels[n], p.x + 10, p.y - 2);
          ctx.fillText((v >= 0 ? '+' : '') + v.toFixed(2), p.x + 10, p.y + 11);
        }
        if (l === 0 && inLabels[n]) {
          ctx.textAlign = 'right';
          ctx.fillText(inLabels[n], p.x - 10, p.y + 4);
          ctx.textAlign = 'left';
        }
      }
    });
  }
}
