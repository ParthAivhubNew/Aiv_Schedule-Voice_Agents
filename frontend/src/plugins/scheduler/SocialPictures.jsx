import React, { useEffect, useState } from "react";
import { Check, Image as ImageIcon } from "lucide-react";
import { api } from "../../api/apiClient";
import { C, FONT_BODY, FONT_DISPLAY } from "../../tokens";

// How this company's AI pictures look: a ready look or their own description, the shape and the quality.
// The picture AI itself is chosen by Outreach; these choices only shape what it is asked to draw.

export const LOOKS = [
  ["modern_saas", "Modern illustration", "Flat shapes, soft gradients, calm colours"],
  ["editorial", "Natural photo", "Real people and places in daylight"],
  ["minimalist_3d", "Soft 3D", "Clay-like 3D with gentle light"],
  ["cinematic", "Cinematic", "Film-still light and colour"],
  ["b2b_ad", "Bold poster", "Strong shapes, high contrast"],
  ["neon_tech", "Dark and glowing", "Moody scene with glowing light"],
  ["custom", "My own look", "Describe it in your own words"],
];
export const SHAPES = [["4:5", "Portrait", "Instagram, Facebook, LinkedIn"], ["1:1", "Square", "Every network"], ["9:16", "Tall", "Stories and Reels"], ["16:9", "Wide", "X and LinkedIn links"]];
export const QUALITIES = [["standard", "Standard", "Faster"], ["high", "High", "Sharper detail, takes longer"]];

const choiceBtn = (on) => ({
  border: `1.5px solid ${on ? C.teal : C.border}`, background: on ? (C.tealSoft || "#E4F5F2") : "#fff", borderRadius: 10,
  padding: "9px 10px", cursor: "pointer", fontFamily: FONT_BODY, textAlign: "left", minWidth: 0,
});

function Choices({ legend, items, value, onChange, columns = "repeat(auto-fill, minmax(150px, 1fr))" }) {
  return (
    <fieldset style={{ border: "none", padding: 0, margin: "14px 0 0" }}>
      <legend style={{ fontSize: 11.5, fontWeight: 700, color: C.slate, marginBottom: 6 }}>{legend}</legend>
      <div style={{ display: "grid", gridTemplateColumns: columns, gap: 8 }}>
        {items.map(([id, name, note]) => (
          <button key={id} type="button" aria-pressed={value === id} onClick={() => onChange(id)} style={choiceBtn(value === id)}>
            <div style={{ fontWeight: 700, fontSize: 12.5, color: C.ink, display: "flex", alignItems: "center", gap: 6 }}>
              {value === id ? <Check size={13} color={C.teal} aria-hidden="true" /> : null}{name}
            </div>
            <div style={{ fontSize: 11, color: C.slate, marginTop: 2 }}>{note}</div>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

// The company-wide picture settings (Accounts page).
export function PictureSettings({ showToast }) {
  const [s, setS] = useState(null);
  const [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.getImageSettings().then((d) => { setS(d); setSaved(d); }).catch(() => setS(false)); }, []);
  if (s === false) return null;
  if (!s) return <div style={{ fontSize: 12.5, color: C.slate, marginBottom: 22 }}>Loading picture settings…</div>;
  const set = (k, v) => setS((o) => ({ ...o, [k]: v }));
  const changed = saved && ["style", "styleCustom", "aspectRatio", "quality"].some((k) => (s[k] || "") !== (saved[k] || ""));
  const save = async () => {
    setBusy(true);
    try {
      const d = await api.saveImageSettings({ style: s.style, styleCustom: s.styleCustom, aspectRatio: s.aspectRatio, quality: s.quality });
      setS(d);
      setSaved(d);
      showToast("Picture settings saved. New pictures use them.");
    } catch (e) {
      showToast(e.message || "Could not save the picture settings.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby="pics-h" style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 16, marginBottom: 22 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <ImageIcon size={16} color={C.teal} aria-hidden="true" />
        <h3 id="pics-h" style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, margin: 0, color: C.ink }}>AI pictures</h3>
      </div>
      <div style={{ fontSize: 12.5, color: C.slate, marginTop: 2, lineHeight: 1.45 }}>
        Your defaults for the pictures the AI draws. If a post request or picture prompt asks for something else, such as "cinematic" or "square", that wins. You can also pick the look, shape and quality for any single picture in the post editor.
      </div>
      <Choices legend="Look" items={LOOKS} value={s.style} onChange={(v) => set("style", v)} />
      {s.style === "custom" ? (
        <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: C.slate, marginTop: 10 }}>Describe your look
          <textarea value={s.styleCustom || ""} maxLength={400} onChange={(e) => set("styleCustom", e.target.value)}
            placeholder="e.g. Watercolour with soft pastel colours and lots of white space, our brand blue #1F4FD8 as the accent"
            style={{ display: "block", width: "100%", boxSizing: "border-box", minHeight: 70, marginTop: 4, borderRadius: 8, border: `1px solid ${C.border}`, padding: 8, fontFamily: FONT_BODY, fontSize: 13, resize: "vertical" }} />
        </label>
      ) : null}
      <Choices legend="Shape" items={SHAPES} value={s.aspectRatio} onChange={(v) => set("aspectRatio", v)} />
      <Choices legend="Quality" items={QUALITIES} value={s.quality} onChange={(v) => set("quality", v)} columns="repeat(auto-fill, minmax(180px, 1fr))" />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
        <button type="button" disabled={busy || !changed || (s.style === "custom" && (s.styleCustom || "").trim().length < 5)} onClick={save}
          style={{ height: 34, padding: "0 14px", borderRadius: 8, border: "none", background: C.teal, color: "#fff", fontWeight: 700, fontSize: 12.5, cursor: "pointer", fontFamily: FONT_BODY, opacity: busy || !changed ? 0.6 : 1 }}>
          {busy ? "Saving…" : "Save picture settings"}
        </button>
        {!changed ? <span style={{ fontSize: 12, color: C.slate }}>Saved</span> : null}
      </div>
    </section>
  );
}
