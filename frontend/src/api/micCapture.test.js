import { describe, expect, it } from "vitest";
import { Downsampler } from "./micCapture";

function tone(freq, rate, seconds) {
  const n = Math.round(rate * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = 0.8 * Math.sin((2 * Math.PI * freq * i) / rate);
  return out;
}

function rms(x, skip = 200) {
  let s = 0;
  let c = 0;
  for (let i = skip; i < x.length; i++) {
    s += x[i] * x[i];
    c++;
  }
  return Math.sqrt(s / c);
}

// Feed in uneven chunks, as the browser does.
function run(ds, signal) {
  const parts = [];
  for (let i = 0; i < signal.length; ) {
    const len = 128 + ((i / 128) % 3) * 64;
    parts.push(ds.process(signal.subarray(i, i + len)));
    i += len;
  }
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  parts.forEach((p) => { out.set(p, o); o += p.length; });
  return out;
}

describe("Downsampler (48 kHz mic -> 8 kHz phone audio)", () => {
  it("keeps speech-band sound", () => {
    const out = run(new Downsampler(48000, 8000), tone(1000, 48000, 0.5));
    expect(out.length).toBeGreaterThan(3990);
    expect(out.length).toBeLessThan(4010);
    expect(rms(out)).toBeGreaterThan(0.5);
  });

  it("removes sound above the phone band instead of folding it back (no aliasing)", () => {
    const out = run(new Downsampler(48000, 8000), tone(6000, 48000, 0.5));
    expect(rms(out)).toBeLessThan(0.02);
  });

  it("works from 44.1 kHz too", () => {
    const out = run(new Downsampler(44100, 8000), tone(800, 44100, 0.5));
    expect(Math.abs(out.length - 4000)).toBeLessThan(10);
    expect(rms(out)).toBeGreaterThan(0.5);
  });
});
