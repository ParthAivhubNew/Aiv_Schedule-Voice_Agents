// Supervisor microphone for call takeover.
//
// Phone calls carry 8 kHz audio. The browser records at 44.1/48 kHz, so the voice must be
// band-limited before dropping samples; otherwise high sounds fold back into the speech band
// and the caller hears a harsh, metallic voice. Downsampler applies a windowed-sinc low-pass
// filter and resamples with fractional steps, keeping state between chunks so there are no
// clicks at chunk edges.
//
// Capture runs in an AudioWorklet (audio thread) so a busy page cannot make the voice stutter;
// older browsers fall back to ScriptProcessorNode.

export class Downsampler {
  constructor(inRate, outRate = 8000, taps = 63, cutoffHz = 3600) {
    this.inRate = inRate;
    this.outRate = outRate;
    this.step = inRate / outRate;
    const n = taps | 1;
    const fc = Math.min(cutoffHz, outRate / 2 - 200) / inRate;
    const mid = (n - 1) / 2;
    this.kernel = new Float32Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const x = i - mid;
      const sinc = x === 0 ? 2 * Math.PI * fc : Math.sin(2 * Math.PI * fc * x) / x;
      const win = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (n - 1)); // Blackman
      this.kernel[i] = sinc * win;
      sum += this.kernel[i];
    }
    for (let i = 0; i < n; i++) this.kernel[i] /= sum;
    this.history = new Float32Array(n - 1); // last samples of the previous chunk
    this.pos = 0; // fractional read position into the (history + chunk) buffer, past the history
  }

  process(input) {
    if (this.inRate === this.outRate) return Float32Array.from(input);
    const k = this.kernel;
    const n = k.length;
    const h = this.history.length;
    const buf = new Float32Array(h + input.length);
    buf.set(this.history, 0);
    buf.set(input, h);
    const out = [];
    // Output sample centred at buf index (h + pos) needs buf[idx - (n-1) .. idx]
    while (this.pos + 1 < input.length) {
      const centre = h + this.pos;
      const i0 = Math.floor(centre);
      const frac = centre - i0;
      const a = this._fir(buf, i0);
      const b = i0 + 1 < buf.length ? this._fir(buf, i0 + 1) : a;
      out.push(a + (b - a) * frac);
      this.pos += this.step;
    }
    this.pos -= input.length;
    this.history = buf.slice(buf.length - h);
    return Float32Array.from(out);
  }

  _fir(buf, end) {
    const k = this.kernel;
    let acc = 0;
    let j = end - (k.length - 1);
    for (let i = 0; i < k.length; i++, j++) {
      if (j >= 0) acc += buf[j] * k[i];
    }
    return acc;
  }
}

const WORKLET_SRC = `
class MicTap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("outreach-mic-tap", MicTap);
`;

// Starts capturing; onChunk receives Float32Array chunks at the context's sample rate.
// Returns a stop() function.
export async function startMicTap(audioCtx, stream, onChunk) {
  const source = audioCtx.createMediaStreamSource(stream);
  const silent = audioCtx.createGain();
  silent.gain.value = 0; // keep the graph running without playing the mic back
  silent.connect(audioCtx.destination);

  if (audioCtx.audioWorklet && typeof AudioWorkletNode !== "undefined") {
    try {
      const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "application/javascript" }));
      await audioCtx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const node = new AudioWorkletNode(audioCtx, "outreach-mic-tap", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
      node.port.onmessage = (e) => onChunk(e.data);
      source.connect(node);
      node.connect(silent);
      return () => {
        try { source.disconnect(); node.disconnect(); silent.disconnect(); node.port.onmessage = null; } catch (_) {}
      };
    } catch (_) {
      // fall through to ScriptProcessor
    }
  }
  const proc = audioCtx.createScriptProcessor(1024, 1, 1);
  proc.onaudioprocess = (e) => onChunk(new Float32Array(e.inputBuffer.getChannelData(0)));
  source.connect(proc);
  proc.connect(silent);
  return () => {
    try { source.disconnect(); proc.disconnect(); silent.disconnect(); proc.onaudioprocess = null; } catch (_) {}
  };
}
