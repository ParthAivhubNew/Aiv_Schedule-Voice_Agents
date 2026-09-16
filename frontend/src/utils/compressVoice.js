const MAX_CLONE_BYTES = 900 * 1024;
const MAX_SECONDS = 75;

function encodeWavBlob(audioBuffer) {
  const samples = audioBuffer.getChannelData(0);
  const sr = audioBuffer.sampleRate;
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buf);
  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i += 1) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i += 1, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

/** Shrink a mic recording so Lightning/nginx 1MB default does not 413. */
export async function compressVoiceBlob(blob, maxBytes = MAX_CLONE_BYTES) {
  if (!blob) return blob;
  if (blob.size <= maxBytes) return blob;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return blob;
  const ctx = new Ctx();
  let decoded;
  try {
    decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  } finally {
    try { await ctx.close(); } catch (_) { /* ignore */ }
  }
  const duration = Math.min(decoded.duration || 0, MAX_SECONDS);
  let sampleRate = 16000;
  if (duration * sampleRate * 2 > maxBytes) sampleRate = 12000;
  if (duration * sampleRate * 2 > maxBytes) sampleRate = 8000;
  const frames = Math.max(1, Math.floor(duration * sampleRate));
  const offline = new OfflineAudioContext(1, frames, sampleRate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();
  return encodeWavBlob(rendered);
}

export function cloneFilename(blob) {
  if (blob && (blob.type || "").includes("wav")) return "reference.wav";
  return "reference.webm";
}
