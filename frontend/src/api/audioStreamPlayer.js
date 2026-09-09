// G.711 Mu-Law Audio Decoder & Web Audio Streaming Player
// Plays real-time phone audio chunks from Twilio/xAI in the browser

function decodeMuLawByte(muLawByte) {
  muLawByte = ~muLawByte;
  const sign = muLawByte & 0x80;
  const exponent = (muLawByte >> 4) & 0x07;
  const mantissa = muLawByte & 0x0f;
  let sample = ((mantissa << 3) + 132) << exponent;
  sample -= 132;
  return (sign !== 0 ? -sample : sample) / 32768.0;
}

function decodeMuLawBase64(base64Str) {
  const binary = atob(base64Str);
  const len = binary.length;
  const float32 = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    float32[i] = decodeMuLawByte(binary.charCodeAt(i));
  }
  return float32;
}

function linearToMuLaw(sample) {
  const BIAS = 0x84;
  const CLIP = 32635;
  let pcm = Math.floor(sample * 32767);
  let sign = (pcm >> 8) & 0x80;
  if (sign !== 0) pcm = -pcm;
  if (pcm > CLIP) pcm = CLIP;
  pcm = pcm + BIAS;
  let exponent = 7;
  for (let expMask = 0x4000; (pcm & expMask) === 0 && exponent > 0; expMask >>= 1) {
    exponent--;
  }
  let mantissa = (pcm >> (exponent + 3)) & 0x0f;
  let byte = ~(sign | (exponent << 4) | mantissa);
  return byte & 0xff;
}

function resampleToAudioContext(pcm8k, targetSampleRate) {
  if (!targetSampleRate || targetSampleRate === 8000) return pcm8k;
  const ratio = 8000 / targetSampleRate;
  const outLength = Math.round(pcm8k.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcIndex = i * ratio;
    const i0 = Math.floor(srcIndex);
    const i1 = Math.min(i0 + 1, pcm8k.length - 1);
    const frac = srcIndex - i0;
    out[i] = pcm8k[i0] * (1 - frac) + pcm8k[i1] * frac;
  }
  return out;
}

function downsampleTo8k(inputData, inputSampleRate) {
  if (!inputSampleRate || inputSampleRate === 8000) return inputData;
  const ratio = inputSampleRate / 8000;
  const outLength = Math.round(inputData.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcIndex = Math.floor(i * ratio);
    out[i] = inputData[Math.min(srcIndex, inputData.length - 1)];
  }
  return out;
}

export class AudioStreamPlayer {
  constructor(callId, onStatusChange, onAudioLevel) {
    this.callId = callId;
    this.onStatusChange = onStatusChange;
    this.onAudioLevel = onAudioLevel;
    this.audioCtx = null;
    this.socket = null;
    this.nextStartTime = 0;
    this.isPlaying = false;
    this.isMicActive = false;
    this.mediaStream = null;
    this.scriptProcessor = null;
    this.silentGainNode = null;
    this.micSampleBuffer = [];
  }

  startListening() {
    if (this.isPlaying) return;

    try {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioCtxClass();
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
    } catch (err) {
      console.error('[AudioPlayer] AudioContext error:', err);
      return;
    }

    const host = window.location.host;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${host}/ws/listen/${this.callId}`;

    console.log(`[AudioPlayer] Connecting to live audio at ${wsUrl}`);
    this.socket = new WebSocket(wsUrl);

    this.socket.onopen = () => {
      console.log(`[AudioPlayer] Connected to live audio stream for ${this.callId}`);
      this.isPlaying = true;
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
      this.nextStartTime = this.audioCtx ? this.audioCtx.currentTime + 0.05 : 0;
      if (this.onStatusChange) this.onStatusChange({ listening: true, connected: true });
    };

    this.socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'audio_chunk' && data.payload) {
          this.playAudioChunk(data.payload, data.track);
        }
      } catch (err) {
        console.warn('[AudioPlayer] Error parsing audio packet:', err);
      }
    };

    this.socket.onclose = () => {
      console.log(`[AudioPlayer] Stream closed for ${this.callId}`);
      this.stopListening();
    };

    this.socket.onerror = (err) => {
      console.error('[AudioPlayer] WebSocket error:', err);
      this.stopListening();
    };
  }

  playAudioChunk(base64Payload, track = 'inbound') {
    if (!this.audioCtx || this.audioCtx.state === 'closed') return;

    try {
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      const pcm8k = decodeMuLawBase64(base64Payload);
      if (pcm8k.length === 0) return;

      // Calculate simple RMS volume level for visualizer
      let sum = 0;
      for (let i = 0; i < pcm8k.length; i++) {
        sum += pcm8k[i] * pcm8k[i];
      }
      const rms = Math.sqrt(sum / pcm8k.length);
      if (this.onAudioLevel) {
        this.onAudioLevel(Math.min(1.0, rms * 6), track);
      }

      // Resample 8kHz telephony audio to the native AudioContext sample rate (e.g. 44.1kHz or 48kHz)
      const resampled = resampleToAudioContext(pcm8k, this.audioCtx.sampleRate);

      // Create an AudioBuffer matching native hardware sample rate for flawless playback
      const buffer = this.audioCtx.createBuffer(1, resampled.length, this.audioCtx.sampleRate);
      buffer.copyToChannel(resampled, 0);

      const source = this.audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.audioCtx.destination);

      // Schedule seamless continuous playback
      const now = this.audioCtx.currentTime;
      if (this.nextStartTime < now) {
        this.nextStartTime = now + 0.015;
      }
      source.start(this.nextStartTime);
      this.nextStartTime += buffer.duration;
    } catch (e) {
      console.warn('[AudioPlayer] Playback error:', e);
    }
  }

  stopListening() {
    this.isPlaying = false;
    this.stopMicrophone();

    if (this.socket) {
      try { this.socket.close(); } catch (_) {}
      this.socket = null;
    }
    if (this.audioCtx) {
      try { this.audioCtx.close(); } catch (_) {}
      this.audioCtx = null;
    }
    if (this.onStatusChange) {
      this.onStatusChange({ listening: false, connected: false });
    }
  }

  async startMicrophone() {
    if (this.isMicActive) return true;

    try {
      if (!this.audioCtx) {
        const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
        this.audioCtx = new AudioCtxClass();
      }
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }

      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });

      const micSource = this.audioCtx.createMediaStreamSource(this.mediaStream);
      // Process chunks: 2048 buffer size
      this.scriptProcessor = this.audioCtx.createScriptProcessor(2048, 1, 1);

      // Connect through a zero-gain node to destination so onaudioprocess fires continuously
      // without echoing the operator's voice back into their own headphones
      this.silentGainNode = this.audioCtx.createGain();
      this.silentGainNode.gain.value = 0.0;

      micSource.connect(this.scriptProcessor);
      this.scriptProcessor.connect(this.silentGainNode);
      this.silentGainNode.connect(this.audioCtx.destination);

      this.micSampleBuffer = [];

      this.scriptProcessor.onaudioprocess = (e) => {
        if (!this.isMicActive || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
        const rawMic = e.inputBuffer.getChannelData(0);
        const inputRate = this.audioCtx.sampleRate;

        // Downsample microphone capture from native rate (e.g. 48kHz) to standard 8000Hz telephony
        const downsampled8k = downsampleTo8k(rawMic, inputRate);
        for (let i = 0; i < downsampled8k.length; i++) {
          this.micSampleBuffer.push(downsampled8k[i]);
        }

        // Frame into 160-sample (20ms at 8kHz) chunks required by Twilio PSTN media streams
        const FRAME_SIZE = 160;
        while (this.micSampleBuffer.length >= FRAME_SIZE) {
          const frame = this.micSampleBuffer.splice(0, FRAME_SIZE);
          const muLawBytes = new Uint8Array(FRAME_SIZE);
          for (let j = 0; j < FRAME_SIZE; j++) {
            muLawBytes[j] = linearToMuLaw(frame[j]);
          }
          let binaryStr = '';
          for (let k = 0; k < FRAME_SIZE; k++) {
            binaryStr += String.fromCharCode(muLawBytes[k]);
          }
          const base64Mic = btoa(binaryStr);
          this.socket.send(JSON.stringify({
            type: 'takeover_audio',
            callId: this.callId,
            payload: base64Mic
          }));
        }
      };

      this.isMicActive = true;
      console.log('[AudioPlayer] Operator microphone live (8kHz 20ms framed)');
      return true;
    } catch (micErr) {
      console.error('[AudioPlayer] Mic access error:', micErr);
      return false;
    }
  }

  stopMicrophone() {
    this.isMicActive = false;
    this.micSampleBuffer = [];
    if (this.scriptProcessor) {
      try { this.scriptProcessor.disconnect(); } catch (_) {}
      this.scriptProcessor = null;
    }
    if (this.silentGainNode) {
      try { this.silentGainNode.disconnect(); } catch (_) {}
      this.silentGainNode = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
  }
}
