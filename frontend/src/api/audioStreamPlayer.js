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

    this.socket = new WebSocket(wsUrl);
    this.socket.binaryType = 'arraybuffer';

    this.socket.onopen = () => {
      console.log(`[AudioPlayer] Connected to live audio stream for ${this.callId}`);
      this.isPlaying = true;
      this.nextStartTime = this.audioCtx.currentTime + 0.05;
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
      const pcmData = decodeMuLawBase64(base64Payload);
      if (pcmData.length === 0) return;

      // Calculate simple RMS volume level for visualizer
      let sum = 0;
      for (let i = 0; i < pcmData.length; i++) {
        sum += pcmData[i] * pcmData[i];
      }
      const rms = Math.sqrt(sum / pcmData.length);
      if (this.onAudioLevel) {
        this.onAudioLevel(Math.min(1.0, rms * 5), track);
      }

      // Create an 8000Hz single-channel audio buffer
      const buffer = this.audioCtx.createBuffer(1, pcmData.length, 8000);
      buffer.copyToChannel(pcmData, 0);

      const source = this.audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.audioCtx.destination);

      // Schedule next buffer seamlessly
      const now = this.audioCtx.currentTime;
      if (this.nextStartTime < now) {
        this.nextStartTime = now + 0.02;
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
          sampleRate: 8000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        }
      });

      const micSource = this.audioCtx.createMediaStreamSource(this.mediaStream);
      // Downsample / process audio to mu-law 8kHz
      this.scriptProcessor = this.audioCtx.createScriptProcessor(2048, 1, 1);

      micSource.connect(this.scriptProcessor);
      this.scriptProcessor.connect(this.audioCtx.destination);

      this.scriptProcessor.onaudioprocess = (e) => {
        if (!this.isMicActive || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
        const inputData = e.inputBuffer.getChannelData(0);
        const muLawBytes = new Uint8Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          muLawBytes[i] = linearToMuLaw(inputData[i]);
        }
        // Base64 encode
        let binaryStr = '';
        for (let i = 0; i < muLawBytes.length; i++) {
          binaryStr += String.fromCharCode(muLawBytes[i]);
        }
        const base64Mic = btoa(binaryStr);
        this.socket.send(JSON.stringify({
          type: 'takeover_audio',
          callId: this.callId,
          payload: base64Mic
        }));
      };

      this.isMicActive = true;
      console.log('[AudioPlayer] Operator microphone live');
      return true;
    } catch (micErr) {
      console.error('[AudioPlayer] Mic access error:', micErr);
      return false;
    }
  }

  stopMicrophone() {
    this.isMicActive = false;
    if (this.scriptProcessor) {
      try { this.scriptProcessor.disconnect(); } catch (_) {}
      this.scriptProcessor = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
  }
}
