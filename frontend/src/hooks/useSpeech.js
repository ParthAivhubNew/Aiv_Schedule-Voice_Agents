import { useCallback, useEffect, useRef, useState } from "react";

const Recognition = () => (typeof window === "undefined" ? null : window.SpeechRecognition || window.webkitSpeechRecognition || null);

export const speechSupported = () => !!Recognition();

// Words a person says into the mic, using the browser's own speech recognition (nothing is sent to our servers).
// onText(text, final) is called as the words arrive; the caller puts them in the message box so the person can fix them before sending.
// Where the browser has no speech recognition, `supported` is false and the mic button should not be shown.
export function useSpeech(onText) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const rec = useRef(null);
  const cb = useRef(onText);
  cb.current = onText;

  const stop = useCallback(() => {
    try { rec.current?.stop(); } catch (_) { /* already stopped */ }
  }, []);

  const start = useCallback(() => {
    const R = Recognition();
    if (!R || rec.current) return;
    setError("");
    const r = new R();
    r.lang = (typeof navigator !== "undefined" && navigator.language) || "en-GB";
    r.interimResults = true;
    r.continuous = true;
    r.maxAlternatives = 1;
    r.onresult = (ev) => {
      let said = "";
      let final = false;
      for (let i = 0; i < ev.results.length; i += 1) {
        said += ev.results[i][0].transcript;
        if (ev.results[i].isFinal) final = true;
      }
      cb.current?.(said.trim(), final);
    };
    r.onerror = (ev) => {
      const code = ev?.error || "";
      if (code === "not-allowed" || code === "service-not-allowed") setError("The microphone is blocked. Allow it in the address bar to speak your message.");
      else if (code === "no-speech") setError("I didn't hear anything. Try again.");
      else if (code === "audio-capture") setError("No microphone was found.");
      else if (code !== "aborted") setError("The microphone stopped. Try again.");
    };
    r.onend = () => { rec.current = null; setListening(false); };
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch (_) {
      rec.current = null;
      setListening(false);
    }
  }, []);

  useEffect(() => () => { try { rec.current?.abort(); } catch (_) { /* gone */ } }, []);

  return { supported: speechSupported(), listening, error, start, stop, clearError: () => setError("") };
}
