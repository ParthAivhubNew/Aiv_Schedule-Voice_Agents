import React, { useEffect, useState } from "react";
import { C } from "../tokens";
import { adminApi } from "./adminApi";
import { btn, card, cell, heading, input, Note, PageTitle, Pill, Table, useLoad } from "./ui";
import { isHost, normaliseAccent } from "../brand/brandLogic";
import { RulesForm } from "../team/RulesTab";
import { draftFrom, toPayload } from "../team/rulesLogic";

const DENIED = "Only a staff admin can change this";
const say = (e) => (e && e.status === 403 ? DENIED : (e && e.message) || "Something went wrong.");

function Toggle({ label, help, checked, onChange, disabled }) {
  return (
    <label style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "6px 0", fontSize: 13, color: C.textInk }}>
      <input type="checkbox" checked={Boolean(checked)} disabled={disabled} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3 }} />
      <span><b style={{ fontWeight: 600 }}>{label}</b><span style={{ display: "block", fontSize: 12, color: C.slate }}>{help}</span></span>
    </label>
  );
}

function Field({ label, help, children }) {
  return (
    <label style={{ display: "block", marginBottom: 12, fontSize: 13, fontWeight: 600, color: C.textInk }}>
      {label}
      <div style={{ marginTop: 4 }}>{children}</div>
      {help ? <span style={{ display: "block", fontSize: 12, fontWeight: 400, color: C.slate, marginTop: 3 }}>{help}</span> : null}
    </label>
  );
}

const lookOf = (b) => ({ name: b.name || "", displayName: b.displayName || "", logoUrl: b.logoUrl || "", accent: b.accent || "", poweredBy: b.poweredBy !== false, hideCredits: Boolean(b.hideCredits), status: b.status || "active" });
const NEW = { name: "", displayName: "", logoUrl: "", accent: "", poweredBy: true, hideCredits: false, status: "active" };

function Editor({ brand, orgs, canEdit, onChanged, onClosed }) {
  const isNew = !brand;
  const [look, setLook] = useState(brand ? lookOf(brand) : NEW);
  const [draft, setDraft] = useState(draftFrom(brand && brand.policy)); // the same editor as Company rules (team/RulesTab.jsx RulesForm)
  const [ruleSets] = useLoad(adminApi.ruleSets);
  const [host, setHost] = useState("");
  const [pick, setPick] = useState("");
  const [msg, setMsg] = useState({ text: "", error: false });
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [look.logoUrl]);

  const run = async (fn, ok) => {
    setMsg({ text: "", error: false });
    try {
      const out = await fn();
      setMsg({ text: ok, error: false });
      await onChanged();
      return out;
    } catch (e) {
      setMsg({ text: say(e), error: true });
      return undefined;
    }
  };
  const fail = (text) => setMsg({ text, error: true });

  const accent = normaliseAccent(look.accent);
  const lookBody = () => ({ name: look.name.trim(), displayName: look.displayName.trim(), logoUrl: look.logoUrl.trim(), accent: accent || "", poweredBy: look.poweredBy, hideCredits: look.hideCredits, status: look.status });
  const policyBody = () => {
    const { payload, problems } = toPayload(draft);
    if (problems.length) {
      fail(problems.join(" "));
      return null;
    }
    return payload;
  };
  const checkLook = () => {
    if (!look.name.trim()) { fail("A brand needs a name."); return false; }
    if (accent === null) { fail("The accent colour is a hex colour like #1f6feb."); return false; }
    return true;
  };

  const create = async () => {
    if (!checkLook()) return;
    const pol = policyBody();
    if (!pol) return;
    const out = await run(() => adminApi.createBrand({ ...lookBody(), policy: pol }), "Brand created.");
    if (out) onClosed(out.id);
  };
  const saveLook = () => { if (checkLook()) run(() => adminApi.editBrand(brand.id, lookBody()), "Look saved."); };
  const savePolicy = () => {
    const pol = policyBody();
    if (pol) run(() => adminApi.setBrandPolicy(brand.id, pol), "Rules saved.");
  };
  const remove = () => {
    if (!window.confirm(`Delete the brand "${brand.name}"? Its web addresses stop showing it.`)) return;
    run(async () => { await adminApi.deleteBrand(brand.id); onClosed(""); }, "");
  };
  const addDomain = () => {
    if (!isHost(host)) { fail("Enter a web address like outreach.example.com (no https://, no path)."); return; }
    run(async () => { await adminApi.addBrandDomain(brand.id, host); setHost(""); }, "Address added.");
  };
  const removeDomain = (d) => { if (window.confirm(`Remove ${d.host} from this brand?`)) run(() => adminApi.removeBrandDomain(brand.id, d.id), "Address removed."); };
  const unlink = (o) => { if (window.confirm(`Take ${o.name} off this brand? It loses the brand's rules.`)) run(() => adminApi.unlinkBrandOrg(brand.id, o.id), "Organisation unlinked."); };
  const link = () => {
    const o = orgs.find((x) => x.id === pick);
    if (!o) return;
    if (o.brandId && o.brandId !== brand.id && !window.confirm(`${o.name} follows ${o.brandName}. Move it to this brand?`)) return;
    run(async () => { await adminApi.linkBrandOrg(brand.id, o.id); setPick(""); }, "Organisation linked.");
  };

  const off = !canEdit;
  const mine = orgs.filter((o) => brand && o.brandId === brand.id);
  const free = orgs.filter((o) => !brand || o.brandId !== brand.id);
  const sectionTitle = (t) => <h3 style={{ ...heading, margin: "0 0 8px" }}>{t}</h3>;
  const row = { display: "flex", gap: 10, alignItems: "center", padding: "4px 0", fontSize: 13 };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={card}>
        {sectionTitle(isNew ? "New brand" : `Look: ${brand.name}`)}
        {off ? <Note error>{DENIED}</Note> : null}
        <Field label="Name" help="Your own label for the brand. Staff see it; customers see the display name."><input style={{ ...input, width: "100%" }} value={look.name} disabled={off} onChange={(e) => setLook({ ...look, name: e.target.value })} /></Field>
        <Field label="Display name" help="What customers see in the menu and on the sign-in page. Leave empty to use the name."><input style={{ ...input, width: "100%" }} value={look.displayName} disabled={off} onChange={(e) => setLook({ ...look, displayName: e.target.value })} /></Field>
        <Field label="Logo address" help="An https:// address or a path starting with /. A square or wide image on a transparent background works best.">
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input style={{ ...input, flex: 1 }} value={look.logoUrl} disabled={off} placeholder="https://" onChange={(e) => setLook({ ...look, logoUrl: e.target.value })} />
            {look.logoUrl && !broken ? <img src={look.logoUrl} alt="Logo preview" referrerPolicy="no-referrer" onError={() => setBroken(true)} style={{ height: 32, maxWidth: 110, objectFit: "contain", border: `1px solid ${C.border}`, borderRadius: 6, padding: 2 }} /> : look.logoUrl ? <span style={{ fontSize: 12, color: C.red }}>Cannot load</span> : null}
          </div>
        </Field>
        <Field label="Accent colour" help="A hex colour like #1f6feb. It tints the brand tile in the menu only.">
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input style={{ ...input, width: 140 }} value={look.accent} disabled={off} placeholder="#1f6feb" aria-invalid={accent === null} onChange={(e) => setLook({ ...look, accent: e.target.value })} />
            <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: 7, border: `1px solid ${C.border}`, background: accent || "transparent" }} />
          </div>
        </Field>
        <Toggle label="Show Powered by Outreach" help="A small line under the menu and on the sign-in page." checked={look.poweredBy} disabled={off} onChange={(v) => setLook({ ...look, poweredBy: v })} />
        <Toggle label="Hide credits" help="Customers of this brand never see credit balances." checked={look.hideCredits} disabled={off} onChange={(v) => setLook({ ...look, hideCredits: v })} />
        <Field label="Status" help="Suspended brands stop showing on their web addresses.">
          <select style={input} value={look.status} disabled={off} onChange={(e) => setLook({ ...look, status: e.target.value })}>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
        </Field>
        {isNew ? null : <button type="button" style={btn(true, off)} disabled={off} onClick={saveLook}>Save the look</button>}
      </div>

      <div style={card}>
        {sectionTitle("Rules")}
        <RulesForm draft={draft} set={(patch) => setDraft((d) => ({ ...d, ...patch }))} sets={ruleSets?.sets || []} level="brand" disabled={off} />
        {isNew ? null : <button type="button" style={{ ...btn(true, off), marginTop: 8 }} disabled={off} onClick={savePolicy}>Save the rules</button>}
      </div>

      {isNew ? (
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" style={btn(true, off)} disabled={off} onClick={create}>Create the brand</button>
          <button type="button" style={btn(false)} onClick={() => onClosed("")}>Cancel</button>
        </div>
      ) : (
        <>
          <div style={card}>
            {sectionTitle("Web addresses")}
            <div style={{ fontSize: 12, color: C.slate, marginBottom: 8 }}>Point the web address at our app, then add it here. People who open it see this brand.</div>
            {brand.domains.map((d) => (
              <div key={d.id} style={row}>
                <span style={{ flex: 1 }}>{d.host}</span>
                <button type="button" style={btn(false, off)} disabled={off} onClick={() => removeDomain(d)}>Remove</button>
              </div>
            ))}
            {brand.domains.length ? null : <div style={{ fontSize: 13, color: C.slate }}>No web address yet.</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <input style={{ ...input, flex: 1 }} aria-label="New web address" value={host} disabled={off} placeholder="outreach.example.com" onChange={(e) => setHost(e.target.value)} />
              <button type="button" style={btn(true, off || !host.trim())} disabled={off || !host.trim()} onClick={addDomain}>Add address</button>
            </div>
          </div>

          <div style={card}>
            {sectionTitle("Organisations")}
            <div style={{ fontSize: 12, color: C.slate, marginBottom: 8 }}>An organisation that follows this brand gets its rules and its look. Unlink it to take them away.</div>
            {mine.map((o) => (
              <div key={o.id} style={row}>
                <span style={{ flex: 1 }}>{o.name}</span>
                <button type="button" style={btn(false, off)} disabled={off} onClick={() => unlink(o)}>Unlink</button>
              </div>
            ))}
            {mine.length ? null : <div style={{ fontSize: 13, color: C.slate }}>No organisation follows this brand.</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <select style={{ ...input, flex: 1 }} aria-label="Organisation to link" value={pick} disabled={off} onChange={(e) => setPick(e.target.value)}>
                <option value="">Choose an organisation</option>
                {free.map((o) => <option key={o.id} value={o.id}>{o.name}{o.brandName ? ` (follows ${o.brandName})` : ""}</option>)}
              </select>
              <button type="button" style={btn(true, off || !pick)} disabled={off || !pick} onClick={link}>Link</button>
            </div>
          </div>

          <div><button type="button" style={{ ...btn(false, off), color: C.red }} disabled={off} onClick={remove}>Delete this brand</button></div>
        </>
      )}
      <Note error={msg.error}>{msg.text}</Note>
    </div>
  );
}

export function Brands({ canEdit }) {
  const [data, error, reload] = useLoad(() => adminApi.brands());
  const [orgData, , reloadOrgs] = useLoad(() => adminApi.brandOrganizations());
  const [open, setOpen] = useState(""); // "" the list, "new", or a brand id
  const refresh = () => Promise.all([reload(), reloadOrgs()]);
  const brands = (data && data.brands) || [];
  const orgs = (orgData && orgData.organizations) || [];
  const current = brands.find((b) => b.id === open);

  return (
    <>
      <PageTitle title="Brands" sub="A brand gives a customer its own name, logo and web address, and rules that its people cannot switch off."
        right={open ? <button type="button" style={btn(false)} onClick={() => setOpen("")}>Back to the list</button> : <button type="button" style={btn(true, !canEdit)} disabled={!canEdit} onClick={() => setOpen("new")}>New brand</button>} />
      <Note error>{error}</Note>
      {!canEdit && !open ? <Note>{DENIED}. You can look around.</Note> : null}
      {open === "new" ? <Editor key="new" orgs={orgs} canEdit={canEdit} onChanged={refresh} onClosed={setOpen} /> : null}
      {current ? <Editor key={current.id} brand={current} orgs={orgs} canEdit={canEdit} onChanged={refresh} onClosed={setOpen} /> : null}
      {!open ? (
        <Table head={["Brand", "Status", "Organisations", "Web addresses", ""]}>
          {brands.map((b) => (
            <tr key={b.id}>
              <td style={cell}><b>{b.name}</b>{b.displayName && b.displayName !== b.name ? <div style={{ fontSize: 11.5, color: C.slate }}>{b.displayName}</div> : null}</td>
              <td style={cell}><Pill tone={b.status === "active" ? "green" : "amber"}>{b.status === "active" ? "Active" : "Suspended"}</Pill></td>
              <td style={cell}>{b.orgCount}</td>
              <td style={cell}>{b.domains.map((d) => d.host).join(", ") || "None yet"}</td>
              <td style={cell}><button type="button" style={btn(false)} onClick={() => setOpen(b.id)}>Open</button></td>
            </tr>
          ))}
          {brands.length || !data ? null : <tr><td style={cell} colSpan={5}>No brands yet.</td></tr>}
        </Table>
      ) : null}
    </>
  );
}
