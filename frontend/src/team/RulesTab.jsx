import React, { useEffect, useState } from "react";
import { C, FONT_BODY } from "../tokens";
import { getOrgRules, getRuleSets, previewOrgRules, saveOrgRules } from "../brand/brandApi";
import { draftFrom, fromBrand, previewLine, SIGNIN_NAMES, SOURCE_NAMES, toPayload } from "./rulesLogic";

// Company rules (plan 12, F1): what the company's admins decide for everyone in it. A rule the brand set (a white-label reseller such as
// FSB) shows as set and can't be relaxed here; the server checks that again on save (PUT /org/rules) and audits every change.
// Voice and Social rules come next (plan 12, step 4); calling hours and the do-not-call list stay in Voice settings.

const text = { fontFamily: FONT_BODY };
const section = { border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, display: "grid", gap: 10 };
const hint = { fontSize: 12, color: C.slate, lineHeight: 1.45 };

function Check({ label, checked, onChange, lockedBy, note }) {
  const locked = Boolean(lockedBy);
  return (
    <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, color: C.textInk, cursor: locked ? "default" : "pointer", lineHeight: 1.4 }}>
      <input type="checkbox" checked={locked ? true : checked} disabled={locked} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 2 }} />
      <span>
        {label}
        {locked ? <span style={{ ...hint, display: "block" }}>Set by {lockedBy}</span> : null}
        {note ? <span style={{ ...hint, display: "block" }}>{note}</span> : null}
      </span>
    </label>
  );
}

export function RulesTab({ flash, initial = null, initialSets = null }) {
  const [view, setView] = useState(initial);
  const [sets, setSets] = useState(initialSets || []);
  const [draft, setDraft] = useState(initial ? draftFrom(initial.company) : null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    if (initial) return undefined;
    let alive = true;
    Promise.all([getOrgRules(), getRuleSets().catch(() => ({ sets: [] }))])
      .then(([v, s]) => {
        if (!alive) return;
        setView(v);
        setSets(s.sets || []);
        setDraft(draftFrom(v.company));
      })
      .catch((e) => alive && setError(e?.message || "Your company's rules couldn't be loaded."));
    return () => {
      alive = false;
    };
  }, [initial]);

  if (error && !view) return <div role="alert" style={{ ...text, color: C.red, fontSize: 13 }}>{error}</div>;
  if (!view || !draft) return <div role="status" style={{ ...text, fontSize: 13, color: C.slate }}>Loading your company's rules…</div>;

  const brand = fromBrand(view.brand);
  const by = view.brandName || "your brand";
  const set = (patch) => { setDraft((d) => ({ ...d, ...patch })); setPreview(null); };
  const toggleSet = (id, on) => set({ sets: on ? [...new Set([...draft.sets, id])] : draft.sets.filter((x) => x !== id) });
  const { payload, problems } = toPayload(draft);

  const runPreview = async () => {
    setBusy(true);
    try {
      setPreview(await previewOrgRules(payload));
    } catch (e) {
      setPreview({ tooBig: true, note: e?.message || "The count couldn't be made just now." });
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (problems.length) return setError(problems.join(" "));
    setBusy(true);
    setError("");
    try {
      const v = await saveOrgRules(payload);
      setView(v);
      setDraft(draftFrom(v.company));
      flash?.("Your company's rules are saved.");
    } catch (e) {
      setError(e?.message || "The rules couldn't be saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ ...text, display: "grid", gap: 14 }}>
      <div style={hint}>
        These rules apply to everyone in your company, on every search, list and export. {view.brandName ? `Rules ${view.brandName} set are shown as set: you can add to them, not remove them.` : ""}
      </div>

      <section aria-label="Companies left out of searches" style={section}>
        <strong style={{ fontSize: 14 }}>Companies left out of searches</strong>
        {sets.map((s) => (
          <Check key={s.id} label={s.label} checked={draft.sets.includes(s.id)} onChange={(on) => toggleSet(s.id, on)}
            lockedBy={brand.sets.includes(s.id) ? by : ""} note={s.desc} />
        ))}
        <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
          Also leave out
          <textarea className="ui-input" rows={4} value={draft.extraText} onChange={(e) => set({ extraText: e.target.value })}
            placeholder={"One per line: a SIC code (84110), a company number (01234567), a postcode district (BN1) or a word (care home)"} style={{ fontFamily: FONT_BODY, fontSize: 13 }} />
          {brand.extra ? <span style={hint}>{by} also leaves out {brand.extra} more.</span> : null}
        </label>
        <div role="radiogroup" aria-label="How the exclusions apply" style={{ display: "grid", gap: 6, fontSize: 13 }}>
          <label style={{ display: "flex", gap: 8 }}><input type="radio" checked={draft.locked} onChange={() => set({ locked: true })} /> Enforced: every search leaves them out</label>
          <label style={{ display: "flex", gap: 8 }}><input type="radio" checked={!draft.locked} onChange={() => set({ locked: false })} /> A starting filter: people can switch it off in Find Leads</label>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={runPreview} disabled={busy}>See how many this hides</button>
          {preview ? <span role="status" style={{ fontSize: 13, color: C.textInk }}>{previewLine(preview)}</span> : null}
        </div>
        <Check label="Hide our members or customers from every search" checked={draft.memberList} onChange={(on) => set({ memberList: on })}
          lockedBy={brand.memberList ? by : ""} note="Once this is saved, upload the list of company numbers in Leads → Member list." />
      </section>

      <section aria-label="Your area" style={section}>
        <strong style={{ fontSize: 14 }}>Your area</strong>
        <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
          Postcode districts your people search in (leave empty for everywhere{brand.districts.length ? ` ${by} allows` : ""})
          <input className="ui-input" value={draft.districtsText} onChange={(e) => set({ districtsText: e.target.value })} placeholder="BN1, BN2, BN3" />
        </label>
        {brand.districts.length ? <span style={hint}>{by} limits searches to {brand.districts.length} districts. Yours must be inside them.</span> : null}
      </section>

      <section aria-label="Data sources" style={section}>
        <strong style={{ fontSize: 14 }}>Data sources</strong>
        {Object.entries(SOURCE_NAMES).map(([k, label]) => (
          <Check key={k} label={`Don't use ${label.toLowerCase()}`} checked={Boolean(draft.sources[k])} onChange={(on) => set({ sources: { ...draft.sources, [k]: on } })}
            lockedBy={brand.sources[k] ? by : ""} />
        ))}
      </section>

      <section aria-label="Exports and phone screening" style={section}>
        <strong style={{ fontSize: 14 }}>Exports</strong>
        <Check label="Leave phone numbers out of exports unless they have a clear TPS / CTPS check" checked={draft.blockUnscreened}
          onChange={(on) => set({ blockUnscreened: on })} lockedBy={brand.blockUnscreened ? by : ""} />
      </section>

      <section aria-label="Sign-in" style={section}>
        <strong style={{ fontSize: 14 }}>How people sign in</strong>
        {Object.entries(SIGNIN_NAMES).map(([k, label]) => {
          const off = Boolean(brand.signinOff[k]);
          return (
            <label key={k} style={{ display: "flex", gap: 8, fontSize: 13, color: off ? C.slate : C.textInk }}>
              <input type="checkbox" checked={!off && Boolean(draft.signin[k])} disabled={off} onChange={(e) => set({ signin: { ...draft.signin, [k]: e.target.checked } })} />
              {label}{off ? ` (switched off by ${by})` : ""}
            </label>
          );
        })}
      </section>

      {error ? <div role="alert" style={{ color: C.red, fontSize: 13 }}>{error}</div> : null}
      <div>
        <button type="button" className="ui-btn ui-btn--primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save rules"}</button>
      </div>
    </div>
  );
}
