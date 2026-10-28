import React, { useEffect, useRef, useState } from "react";
import { Loader } from "../../app/Loader";
import { Film, Sparkles } from "lucide-react";
import { api } from "../../api/apiClient";
import { C, FONT_BODY, HUB_PAPER } from "../../tokens";

// The Video tab of the approvals editor. It works like the Image tab: ask for a change in the chat,
// or edit the prompt and draw again. Shape and length are read from the prompt ("wide", "8 seconds").
// The clip is added to the post when it is ready, even if the window is closed.

const secBtn = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, height: 36, padding: "0 12px",
  borderRadius: 9, border: `1px solid ${C.border}`, background: "#fff", color: C.ink, fontWeight: 700, fontSize: 12.5,
  cursor: "pointer", fontFamily: FONT_BODY, width: "100%",
};

const live = (j) => j && (j.state === "queued" || j.state === "making");

export function VideoPanel({ post, canEdit, Chat, showToast, onRefresh }) {
  const [info, setInfo] = useState(null);
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [chat, setChat] = useState([]);
  const basePrompt = (post.videoPrompt || post.imagePrompt || post.headline || "").trim();
  const [prompt, setPrompt] = useState(basePrompt);
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;

  useEffect(() => {
    setPrompt(basePrompt);
    setChat([]);
    setJob(null);
    api.getVideos(post.id).then((d) => {
      setInfo(d);
      setJob((d.jobs || []).find(live) || null);
    }).catch(() => setInfo({ available: false, jobs: [] }));
  }, [post.id]);

  useEffect(() => {
    if (!live(job)) return undefined;
    const t = window.setInterval(() => {
      api.getVideo(job.id).then((d) => {
        setJob(d.job);
        if (d.job.state === "done") {
          setChat((m) => [...m, { id: "vd_" + Date.now(), who: "ai", text: "Done. The new video is in the preview." }]);
          if (refreshRef.current) refreshRef.current();
        }
      }).catch(() => {});
    }, 6000);
    return () => window.clearInterval(t);
  }, [job && job.id, job && job.state]);

  const start = async (text, asChange) => {
    setBusy(true);
    try {
      const r = await api.makeVideo({ prompt: text, postId: post.id });
      setJob(r.job);
      if (asChange) setChat((m) => [...m, { id: "vu_" + Date.now(), who: "user", text: asChange }]);
    } catch (e) {
      if (showToast) showToast(e.message || "The video could not be started.");
    } finally {
      setBusy(false);
    }
  };
  const sendChange = () => {
    const change = note.trim();
    if (!change) return;
    setNote("");
    start(`${prompt} Change requested: ${change}. Keep the same people and place.`, change);
  };

  if (!info) return <Loader compact label="Loading" />;
  if (!info.available) {
    return <div style={{ fontSize: 12.5, color: C.ink, lineHeight: 1.45 }}>Video making is not set up for your account yet. Ask Outreach support to switch it on.</div>;
  }
  const making = live(job);
  return (
    <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
      <Chat
        messages={chat}
        busyLabel={making ? "Making your video. This usually takes 1 to 5 minutes…" : ""}
        value={note}
        onChange={setNote}
        onSubmit={sendChange}
        disabled={!canEdit || busy || making}
        placeholder="Describe the video change…"
      />
      {job && job.state === "failed" ? <div role="alert" style={{ fontSize: 12, color: C.red }}>{job.error}</div> : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label style={{ fontSize: 11.5, fontWeight: 700, color: C.slate }} htmlFor={"vp_" + post.id}>Video prompt</label>
        <textarea
          id={"vp_" + post.id}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          maxLength={1500}
          style={{ width: "100%", boxSizing: "border-box", borderRadius: 8, border: `1px solid ${C.border}`, padding: 8, fontFamily: FONT_BODY, fontSize: 12, resize: "vertical" }}
        />
        <div style={{ fontSize: 11, color: C.slate, lineHeight: 1.4, background: HUB_PAPER, borderRadius: 8, padding: "6px 8px" }}>
          Say the shape or length in the prompt, for example "wide", "reel" or "8 seconds". Otherwise it is tall and about 5 seconds.
        </div>
        <button type="button" disabled={!canEdit || busy || making || prompt.trim().length < 10} onClick={() => start(prompt)} style={secBtn}>
          <Sparkles size={14} /> {busy ? "Starting…" : "Make video from this prompt"}
        </button>
        <div style={{ fontSize: 11, color: C.slate, textAlign: "center" }}>
          <Film size={11} aria-hidden="true" style={{ verticalAlign: "-1px" }} /> {info.credits} credits per clip, charged only if it is made.
        </div>
      </div>
    </div>
  );
}
