import React, { useState, useEffect, useRef } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import {
  Mic,
  MicOff,
  PhoneOff,
  Radio,
  Volume2,
  Terminal,
  RefreshCw,
  Copy,
  Check,
  Sparkles,
  ShieldCheck,
  X,
  Headphones,
  AlertCircle,
} from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../tokens";
import { api } from "../api/apiClient";

export function LiveKitBrowserCallModal({
  isOpen,
  onClose,
  prospectName = "Browser Caller",
  prospectPhone = "Browser WebRTC",
  companyName = "AIVHub",
  onCallEnded,
}) {
  const [callState, setCallState] = useState("idle"); // idle | requesting_token | connecting | connected | ended | error
  const [errorMessage, setErrorMessage] = useState("");
  const [isMuted, setIsMuted] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [serverStatus, setServerStatus] = useState(null);
  const [copied, setCopied] = useState(false);
  const [transcripts, setTranscripts] = useState([
    { who: "system", text: "Ready to test in-browser voice with LiveKit WebRTC." },
  ]);
  const [waveformLevels, setWaveformLevels] = useState([15, 20, 15, 25, 20, 15, 20, 15, 25, 20, 15, 20]);

  const roomRef = useRef(null);
  const timerRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);
  const localTrackRef = useRef(null);

  // Check LiveKit server status on open
  useEffect(() => {
    if (!isOpen) return;

    let mounted = true;
    api.getLiveKitStatus()
      .then((status) => {
        if (mounted) setServerStatus(status);
      })
      .catch(() => {
        if (mounted) {
          setServerStatus({
            online: false,
            details: "LiveKit server is not reachable at port 7880. Run 'docker compose up -d livekit'.",
          });
        }
      });

    return () => {
      mounted = false;
    };
  }, [isOpen]);

  // Duration timer
  useEffect(() => {
    if (callState === "connected") {
      timerRef.current = setInterval(() => {
        setCallDuration((d) => d + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [callState]);

  // Audio waveform visualizer loop
  const startVisualizer = (mediaStream) => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(mediaStream);
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateWave = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);

        // Sample 12 frequency points
        const levels = [];
        const step = Math.max(1, Math.floor(bufferLength / 12));
        for (let i = 0; i < 12; i++) {
          const val = dataArray[i * step] || 0;
          levels.push(Math.min(100, Math.max(12, Math.round((val / 255) * 100))));
        }
        setWaveformLevels(levels);
        animFrameRef.current = requestAnimationFrame(updateWave);
      };

      updateWave();
    } catch (err) {
      console.warn("Visualizer init warning:", err);
    }
  };

  const stopVisualizer = () => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch (_) {}
      audioContextRef.current = null;
    }
    setWaveformLevels([15, 20, 15, 25, 20, 15, 20, 15, 25, 20, 15, 20]);
  };

  const startBrowserCall = async () => {
    try {
      setErrorMessage("");
      setCallState("requesting_token");
      setTranscripts([
        { who: "system", text: "Requesting WebRTC authorization token from backend..." },
      ]);

      // 1. Fetch LiveKit token from backend
      const tokenRes = await api.createLiveKitToken({
        prospect_name: prospectName,
        prospect_phone: prospectPhone,
        company_name: companyName,
        role: "user",
      });

      if (!tokenRes || !tokenRes.token) {
        throw new Error("No token returned from server");
      }

      setCallState("connecting");
      setTranscripts((prev) => [
        ...prev,
        { who: "system", text: `Connecting to LiveKit SFU (${tokenRes.ws_url})...` },
      ]);

      // 2. Initialize LiveKit Room
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      roomRef.current = room;

      // Event: Remote track subscribed (incoming audio from agent or other participant)
      room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (track.kind === Track.Kind.Audio) {
          const audioElement = track.attach();
          audioElement.play().catch((e) => console.warn("Audio play warning:", e));
          setTranscripts((prev) => [
            ...prev,
            { who: "system", text: `Subscribed to audio track from ${participant.identity}` },
          ]);
        }
      });

      // Event: Participant joined
      room.on(RoomEvent.ParticipantConnected, (participant) => {
        setTranscripts((prev) => [
          ...prev,
          { who: "system", text: `${participant.name || participant.identity} joined room` },
        ]);
      });

      // Event: Data message received (live transcripts/text)
      room.on(RoomEvent.DataReceived, (payload, participant) => {
        try {
          const str = new TextDecoder().decode(payload);
          const data = JSON.parse(str);
          if (data && data.text) {
            setTranscripts((prev) => [
              ...prev,
              { who: data.who || (participant ? participant.identity : "ai"), text: data.text },
            ]);
          }
        } catch (_) {}
      });

      // Event: Disconnected
      room.on(RoomEvent.Disconnected, () => {
        setCallState("ended");
        stopVisualizer();
        if (onCallEnded) onCallEnded();
      });

      // 3. Connect to room
      await room.connect(tokenRes.ws_url, tokenRes.token);

      // 4. Enable microphone
      await room.localParticipant.enableCameraAndMicrophone(false, true);

      // Capture local track for visualizer
      const audioTracks = room.localParticipant.audioTrackPublications;
      if (audioTracks && audioTracks.size > 0) {
        const pub = Array.from(audioTracks.values())[0];
        if (pub && pub.track && pub.track.mediaStream) {
          localTrackRef.current = pub.track;
          startVisualizer(pub.track.mediaStream);
        }
      }

      setCallState("connected");
      setTranscripts((prev) => [
        ...prev,
        { who: "system", text: "Connected via WebRTC. Speak into your microphone now." },
      ]);
    } catch (err) {
      console.error("LiveKit Call Error:", err);
      setCallState("error");
      stopVisualizer();

      let friendly = err.message || "Failed to establish WebRTC connection";
      if (friendly.includes("Failed to fetch") || friendly.includes("NetworkError") || friendly.includes("ECONNREFUSED") || friendly.includes("timeout")) {
        friendly = "Cannot connect to LiveKit server. Ensure the Docker container is running.";
      }
      setErrorMessage(friendly);
      setTranscripts((prev) => [
        ...prev,
        { who: "system", text: `Connection error: ${friendly}` },
      ]);
    }
  };

  const endBrowserCall = async () => {
    stopVisualizer();
    if (roomRef.current) {
      try {
        await roomRef.current.disconnect();
      } catch (_) {}
      roomRef.current = null;
    }
    setCallState("ended");
    if (onCallEnded) onCallEnded();
  };

  const toggleMute = async () => {
    if (!roomRef.current) return;
    try {
      const next = !isMuted;
      await roomRef.current.localParticipant.setMicrophoneEnabled(!next);
      setIsMuted(next);
    } catch (e) {
      console.warn("Mute error:", e);
    }
  };

  const formatTimer = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m < 10 ? "0" : ""}${m}:${s < 10 ? "0" : ""}${s}`;
  };

  const copyDockerCommand = () => {
    navigator.clipboard.writeText("docker compose up -d livekit");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(10, 14, 26, 0.72)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 580,
          background: "#FFFFFF",
          borderRadius: 24,
          border: `1px solid ${C.border}`,
          boxShadow: "0 24px 60px rgba(10, 14, 26, 0.28)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "20px 24px",
            borderBottom: `1px solid ${C.borderLight}`,
            background: C.paperSoft,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 12,
                background: C.cobaltSoft,
                color: C.cobalt,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Headphones size={20} />
            </div>
            <div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink }}>
                Talk in Browser (LiveKit WebRTC)
              </div>
              <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>
                High-fidelity 48kHz WebRTC audio · Zero carrier costs
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              endBrowserCall();
              onClose();
            }}
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              border: `1px solid ${C.border}`,
              background: "#fff",
              color: C.slate,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Content Body */}
        <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Target Persona Card */}
          <div
            style={{
              background: C.paper,
              borderRadius: 14,
              padding: "14px 18px",
              border: `1px solid ${C.borderLight}`,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Target Context
              </div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.ink, marginTop: 2 }}>
                {prospectName} · <span style={{ color: C.cobalt }}>{companyName}</span>
              </div>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                borderRadius: 20,
                background: callState === "connected" ? C.greenSoft : C.paperSoft,
                color: callState === "connected" ? C.green : C.slate,
                fontSize: 12,
                fontWeight: 700,
                fontFamily: FONT_MONO,
              }}
            >
              <Radio size={14} className={callState === "connected" ? "animate-pulse" : ""} />
              {callState === "connected" ? formatTimer(callDuration) : callState.toUpperCase()}
            </div>
          </div>

          {/* Visualizer Card */}
          <div
            style={{
              background: callState === "connected" ? "#0F172A" : C.paperSoft,
              borderRadius: 16,
              padding: "24px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 140,
              gap: 16,
              transition: "background 0.3s ease",
            }}
          >
            {callState === "connected" ? (
              <div style={{ display: "flex", alignItems: "center", gap: 6, height: 60, width: "80%", justifyContent: "center" }}>
                {waveformLevels.map((h, i) => (
                  <div
                    key={i}
                    style={{
                      flex: 1,
                      maxWidth: 10,
                      height: `${h}%`,
                      background: isMuted ? "#64748B" : C.cobalt,
                      borderRadius: 4,
                      transition: "height 0.08s ease",
                      boxShadow: isMuted ? "none" : "0 0 10px rgba(52,87,213,0.5)",
                    }}
                  />
                ))}
              </div>
            ) : (
              <div style={{ textAlign: "center", color: C.slate }}>
                <Headphones size={36} style={{ margin: "0 auto 10px", opacity: 0.6 }} />
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {callState === "connecting"
                    ? "Establishing WebRTC ICE connection..."
                    : callState === "requesting_token"
                    ? "Securing room token..."
                    : callState === "ended"
                    ? "Call session ended"
                    : "Ready to test audio directly from your browser"}
                </div>
              </div>
            )}
          </div>

          {/* Transcripts Stream */}
          <div
            style={{
              background: C.paper,
              borderRadius: 12,
              padding: 14,
              border: `1px solid ${C.borderLight}`,
              maxHeight: 140,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 6,
              fontFamily: FONT_MONO,
              fontSize: 12,
            }}
          >
            {transcripts.map((t, idx) => (
              <div key={idx} style={{ lineHeight: 1.4 }}>
                <span
                  style={{
                    color: t.who === "system" ? C.slate : t.who === "ai" ? C.cobalt : C.ink,
                    fontWeight: 700,
                    marginRight: 6,
                  }}
                >
                  [{t.who}]:
                </span>
                <span style={{ color: C.textInk }}>{t.text}</span>
              </div>
            ))}
          </div>

          {/* If server offline notification / instructions */}
          {serverStatus && !serverStatus.online && callState !== "connected" && (
            <div
              style={{
                background: C.amberSoft,
                border: `1px solid ${C.amber}`,
                borderRadius: 12,
                padding: "12px 16px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.amber, fontWeight: 700, fontSize: 13 }}>
                <AlertCircle size={16} /> LiveKit Docker Container is Offline
              </div>
              <div style={{ fontSize: 12, color: C.textInk }}>
                To enable in-browser WebRTC calling, start the official LiveKit container on your server:
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: "#fff",
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: `1px solid ${C.border}`,
                  fontFamily: FONT_MONO,
                  fontSize: 12,
                }}
              >
                <span>docker compose up -d livekit</span>
                <button
                  type="button"
                  onClick={copyDockerCommand}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: copied ? C.green : C.cobalt,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            {callState === "connected" ? (
              <>
                <button
                  type="button"
                  onClick={toggleMute}
                  style={{
                    height: 44,
                    padding: "0 18px",
                    borderRadius: 12,
                    border: `1px solid ${C.border}`,
                    background: isMuted ? C.amberSoft : "#fff",
                    color: isMuted ? C.amber : C.textInk,
                    cursor: "pointer",
                    fontWeight: 700,
                    fontSize: 13,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
                  {isMuted ? "Unmute Mic" : "Mute Mic"}
                </button>
                <button
                  type="button"
                  onClick={endBrowserCall}
                  style={{
                    height: 44,
                    padding: "0 22px",
                    borderRadius: 12,
                    border: "none",
                    background: C.red,
                    color: "#fff",
                    cursor: "pointer",
                    fontWeight: 700,
                    fontSize: 13,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    boxShadow: "0 6px 16px rgba(224, 49, 49, 0.3)",
                  }}
                >
                  <PhoneOff size={16} /> End Call
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    height: 44,
                    padding: "0 18px",
                    borderRadius: 12,
                    border: `1px solid ${C.border}`,
                    background: "#fff",
                    color: C.slate,
                    cursor: "pointer",
                    fontWeight: 600,
                    fontSize: 13,
                  }}
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={startBrowserCall}
                  disabled={callState === "connecting" || callState === "requesting_token"}
                  style={{
                    height: 44,
                    padding: "0 24px",
                    borderRadius: 12,
                    border: "none",
                    background: C.gradientPrimary,
                    color: "#fff",
                    cursor: "pointer",
                    fontWeight: 700,
                    fontSize: 13,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    boxShadow: "0 6px 18px rgba(52, 87, 213, 0.35)",
                  }}
                >
                  <Headphones size={16} />
                  {callState === "connecting" ? "Connecting..." : "Start Browser Call"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
