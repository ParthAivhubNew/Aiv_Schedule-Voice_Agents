import React, { useMemo, useState } from "react";
import { C } from "../../tokens";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { niceName, orgGroups } from "./companyLogic";

// The people of one company drawn as an org chart. Clicking anyone opens that person's own page.
const TONE = {
  green: { bg: "#e9f6cf", bar: "#6aa621", ink: "#2f4a0c" },
  blue: { bg: "#dcecfb", bar: "#2f7fd1", ink: "#12395f" },
  orange: { bg: "#fbe3d8", bar: "#d9622b", ink: "#6a2a0c" },
};
const css = `
.oc{display:grid;gap:14px;min-width:0}
.oc-scroll{overflow-x:auto;padding:4px 2px 10px}
.oc-root{display:flex;flex-direction:column;align-items:center;min-width:min-content}
.oc-rootcard{all:unset;cursor:pointer;box-sizing:border-box;background:#fbeaa0;border:1px solid #e3cf6f;border-radius:12px;padding:10px 16px;max-width:340px;text-align:center;box-shadow:0 2px 6px rgba(0,0,0,.08)}
.oc-rootcard:focus-visible,.oc-card:focus-visible,.oc-head:focus-visible{outline:2px solid var(--ui-accent,#2f5bd1);outline-offset:2px}
.oc-stem{width:2px;height:18px;background:#c9ced6}
.oc-cols{display:flex;gap:18px;align-items:flex-start;justify-content:center;border-top:2px solid #c9ced6}
.oc-col{position:relative;display:grid;gap:8px;width:250px;flex:0 0 250px;padding-top:18px}
.oc-col:before{content:"";position:absolute;top:0;left:50%;width:2px;height:18px;background:#c9ced6}
.oc-head{all:unset;cursor:pointer;box-sizing:border-box;display:flex;align-items:center;gap:6px;border-radius:10px;padding:8px 10px;font-size:13px;font-weight:700;border-left:4px solid}
.oc-list{display:grid;gap:8px;margin-left:14px;padding-left:12px;border-left:2px solid #c9ced6}
.oc-card{all:unset;cursor:pointer;box-sizing:border-box;display:grid;gap:2px;border-radius:10px;padding:8px 10px;border-left:4px solid;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.oc-card:hover{box-shadow:0 0 0 2px var(--ui-accent,#2f5bd1)}
.oc-name{font-size:13.5px;font-weight:600;overflow-wrap:anywhere}
.oc-sub{font-size:12px;opacity:.85;overflow-wrap:anywhere}
@media (max-width:640px){.oc-root{align-items:stretch}.oc-rootcard{max-width:none}.oc-cols{flex-direction:column;align-items:stretch;border-top:0}.oc-col{width:auto;flex:1 1 auto;padding-top:0}.oc-col:before{display:none}.oc-stem{display:none}}
`;

export function OrgChart({ c, onOpenPerson, onOverview }) {
  const [query, setQuery] = useState("");
  const [shut, setShut] = useState({});
  const groups = useMemo(() => orgGroups(c.people, query), [c.people, query]);
  const total = useMemo(() => orgGroups(c.people).reduce((n, g) => n + g.people.length, 0), [c.people]);
  const name = niceName(c.name);
  const number = c.registration_number;

  return (
    <div className="oc">
      <style>{css}</style>
      <label style={{ display: "flex", gap: 8, alignItems: "center", border: `1px solid ${C.border}`, borderRadius: 10, padding: "6px 10px", background: "#fff", maxWidth: 360 }}>
        <Search size={14} color={C.slate} aria-hidden="true" />
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a person or role" aria-label="Find a person or role" style={{ border: 0, outline: 0, flex: 1, fontSize: 13.5, minWidth: 0, background: "transparent" }} />
      </label>
      <div className="oc-scroll">
        <div className="oc-root">
          <button type="button" className="oc-rootcard" onClick={onOverview} title="Open this company's overview">
            <div className="oc-name">{name}</div>
            <div className="oc-sub">{number ? `No. ${number}` : "Company"} · {total} {total === 1 ? "person" : "people"}</div>
          </button>
          <div className="oc-stem" />
          {groups.length ? (
            <div className="oc-cols">
              {groups.map((g) => {
                const t = TONE[g.tone];
                const closed = Boolean(shut[g.key]) && !query;
                return (
                  <div key={g.key} className="oc-col">
                    <button type="button" className="oc-head" title={closed ? "Show this group" : "Fold this group"} aria-expanded={!closed} style={{ background: t.bg, color: t.ink, borderColor: t.bar }} onClick={() => setShut((s) => ({ ...s, [g.key]: !s[g.key] }))}>
                      {closed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />} {g.title} <span style={{ fontWeight: 500 }}>· {g.people.length}</span>
                    </button>
                    {closed ? null : (
                      <div className="oc-list">
                        {g.people.map((p) => (
                          <button key={p.key} type="button" className="oc-card" title="Open this person's profile" style={{ background: t.bg, color: t.ink, borderColor: t.bar }} onClick={() => onOpenPerson(p)}>
                            <span className="oc-name">{p.name}</span>
                            <span className="oc-sub">{p.role}{p.alsoOwner ? " · also an owner" : ""}</span>
                            {p.meta ? <span className="oc-sub">{p.meta}</span> : null}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: C.slate, padding: 10 }}>{query ? "Nobody matches that." : "No people have been read from the register for this company yet."}</div>
          )}
        </div>
      </div>
      <div style={{ fontSize: 12.5, color: C.slate }}>Click anyone to open their profile. Columns are by role: the register does not say who reports to whom.</div>
    </div>
  );
}
