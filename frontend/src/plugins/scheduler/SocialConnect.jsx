import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loader } from "../../app/Loader";
import { CalendarDays, ChevronDown, Lightbulb, Lock, Mail, MessageCircle, Phone, RefreshCw, Sparkles, UserPlus, Users } from "lucide-react";
import { api } from "../../api/apiClient";
import { C, FONT_BODY, FONT_DISPLAY, HUB_PAPER } from "../../tokens";
import { missingNames, openPlans, useConnection } from "../../hooks/useConnections";
import { CallDialog } from "../leadgen/CallFlow";

// Social working with Leads and Voice: who engaged with a post (and turning them into leads), a booking link that credits
// meetings to a post, sharing a post with a list, and post ideas from your leads and your calls.

// Social's own colours (the same teal the sidebar and buttons use).
const TEAL = "#0C8C7D";
const TEAL_SOFT = "#E4F5F2";
const TEAL_INK = "#065F54";
const NETWORKS = {
  linkedin: ["LinkedIn", "#0A66C2", "#E8F1FA"], x: ["X", "#111827", "#EFEFEF"], facebook: ["Facebook", "#1877F2", "#E7F0FE"],
  instagram: ["Instagram", "#C13584", "#FDECF5"], threads: ["Threads", "#000000", "#F4F4F5"], reddit: ["Reddit", "#D93A00", "#FFF0E8"],
};

const text = { fontFamily: FONT_BODY };
const muted = { ...text, fontSize: 12.5, color: C.slate, lineHeight: 1.5 };
const card = { background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14 };
const h3 = { fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.ink, margin: 0 };

function when(iso) {
  if (!iso) return "";
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z");
  return isNaN(d) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function NetworkChip({ id }) {
  const [name, color, soft] = NETWORKS[String(id || "").toLowerCase()] || [id, C.slate, HUB_PAPER];
  return <span style={{ fontSize: 11, fontWeight: 700, color, background: soft, borderRadius: 99, padding: "2px 8px", whiteSpace: "nowrap" }}>{name}</span>;
}

function Locked({ link, what }) {
  const { available, missing, loading } = useConnection(link);
  if (loading || available) return null;
  return (
    <div style={{ ...muted, display: "flex", gap: 8, alignItems: "center", background: HUB_PAPER, border: `1px dashed ${C.border}`, borderRadius: 10, padding: "10px 12px", flexWrap: "wrap" }}>
      <Lock size={14} aria-hidden="true" /> <span style={{ flex: 1, minWidth: 180 }}>{what} needs {missingNames(missing)}.</span>
      <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => openPlans(missing[0])}>See plans</button>
    </div>
  );
}

function IconBadge({ icon: Icon }) {
  return (
    <span aria-hidden="true" style={{ width: 34, height: 34, borderRadius: 10, background: TEAL_SOFT, color: TEAL, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <Icon size={17} />
    </span>
  );
}

function PostRow({ post, toast, lists, meetings }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [busy, setBusy] = useState("");
  const [share, setShare] = useState(null); // { listId, note }
  const [call, setCall] = useState(null);
  const [manual, setManual] = useState({ name: "", company: "", text: "" });
  const leads = useConnection("social_audience");
  const calls = useConnection("comment_to_call");
  const booking = useConnection("post_booking_link");

  const load = useCallback(async () => {
    try { setData(await api.getPostEngagers(post.id)); } catch (e) { toast(e.message || "Couldn't load who engaged."); }
  }, [post.id, toast]);
  useEffect(() => { if (open) load(); }, [open, load]);
  const [preview, setPreview] = useState(null);
  const shareList = share && share.listId;
  const sendable = preview ? preview.people.filter((p) => !p.skip) : [];
  useEffect(() => {
    setPreview(null);
    if (!shareList) return undefined;
    let live = true;
    api.getSharePreview(shareList).then((d) => { if (live) setPreview(d); }).catch((e) => { if (live) { setPreview({ people: [] }); toast(e.message || "Couldn't load that list."); } });
    return () => { live = false; };
  }, [shareList]);

  const run = async (key, fn) => {
    setBusy(key);
    try { await fn(); } catch (e) { toast(e.message || "That didn't work."); } finally { setBusy(""); }
  };
  const refresh = () => run("refresh", async () => {
    const r = await api.refreshPostEngagers(post.id);
    toast(r.errors?.length ? r.errors[0] : `${r.new} new ${r.new === 1 ? "person" : "people"} found.`);
    await load();
  });
  const addHand = () => run("hand", async () => {
    await api.addPostEngagers(post.id, [{ name: manual.name, company: manual.company, text: manual.text, network: "manual" }]);
    setManual({ name: "", company: "", text: "" });
    await load();
  });
  const toList = (thenCall) => run("list", async () => {
    const ids = [...picked];
    const r = await api.engagersToList(ids);
    toast(`${r.added} added to ${r.list.name}${r.linked ? `, ${r.linked} already leads` : ""}.`);
    setPicked(new Set());
    await load();
    if (thenCall && r.list?.id) setCall({ kind: "list", id: r.list.id, name: r.list.name });
  });
  const link = () => run("link", async () => {
    const r = await api.getPostBookingLink(post.id);
    try { await navigator.clipboard.writeText(r.url); toast("Booking link copied. Paste it into this post or its comments."); } catch (_) { toast(r.url); }
  });
  const doShare = () => run("share", async () => {
    const r = await api.sharePostToList(post.id, share.listId, share.note, share.chosen ? [...share.chosen] : []);
    toast(`Draft campaign made for ${r.people} ${r.people === 1 ? "person" : "people"}${r.skipped ? ` (${r.skipped} skipped)` : ""}. Check it under Campaigns in Lead Gen, then start it.`);
    setShare(null);
  });

  const live = (post.publishResults || []).filter((r) => r.ok);
  const channels = post.channels || [];
  const people = data ? data.engagers.length : null;
  return (
    <article style={{ ...card, borderColor: open ? TEAL : C.border, overflow: "hidden" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", padding: "12px 14px" }}>
        <div style={{ flex: "1 1 280px", minWidth: 0 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 4 }}>
            {channels.map((c) => <NetworkChip key={c} id={c} />)}
            <span style={{ ...muted, fontSize: 12 }}>{post.publishedAt ? `Published ${when(post.publishedAt)}` : "Published"}</span>
            {meetings ? (
              <span style={{ fontSize: 11, fontWeight: 700, color: TEAL_INK, background: TEAL_SOFT, borderRadius: 99, padding: "2px 8px" }}>
                {meetings} meeting{meetings === 1 ? "" : "s"} booked from it
              </span>
            ) : null}
          </div>
          <div style={{ ...text, fontSize: 14, fontWeight: 600, color: C.ink, overflowWrap: "anywhere" }}>{post.title || "Untitled post"}</div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <Users size={13} /> See who engaged <ChevronDown size={13} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
          </button>
          {booking.available ? (
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={busy === "link"} title="A page where people pick a time. Meetings booked through it are credited to this post" onClick={link}>
              <CalendarDays size={13} /> Copy booking link
            </button>
          ) : null}
          {leads.available && live.length ? (
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" title="Email a short note with this post's link to one of your lists" onClick={() => setShare({ listId: lists[0]?.id || "", note: "" })}>
              <Mail size={13} /> Email to a list
            </button>
          ) : null}
        </div>
      </div>

      {share ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 14px", borderTop: `1px solid ${C.border}`, background: HUB_PAPER }}>
          {!lists.length ? <span style={muted}>No lists yet. Make one in Lead Gen first.</span> : (
            <>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ ...muted, color: C.ink, fontWeight: 600 }}>Email this post to</span>
                <select className="ui-input" aria-label="List" style={{ width: "auto", maxWidth: 220 }} value={share.listId} onChange={(e) => setShare({ ...share, listId: e.target.value, chosen: null, pick: false })}>
                  {lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.ids.length})</option>)}
                </select>
                <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" aria-expanded={Boolean(share.pick)} disabled={!preview || !sendable.length}
                  onClick={() => setShare({ ...share, pick: !share.pick, chosen: share.chosen || new Set(sendable.map((p) => p.id)) })}>
                  <Users size={13} /> {!preview ? "Loading…" : share.chosen ? `${share.chosen.size} of ${sendable.length} chosen` : `Everyone (${sendable.length})`}
                </button>
                <input className="ui-input" aria-label="A line to go with it" style={{ flex: 1, minWidth: 160 }} placeholder="A line to go with it (optional)" maxLength={300} value={share.note} onChange={(e) => setShare({ ...share, note: e.target.value })} />
                <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" disabled={!share.listId || busy === "share" || !preview || (share.chosen && !share.chosen.size)} onClick={doShare}>Make a draft campaign</button>
                <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setShare(null)}>Cancel</button>
              </div>
              {share.pick && preview ? (
                <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 10, padding: 8 }}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
                    <input className="ui-input" aria-label="Search the list" placeholder="Search name, company or email" style={{ flex: 1, minWidth: 160, height: 30 }} value={share.q || ""} onChange={(e) => setShare({ ...share, q: e.target.value })} />
                    <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setShare({ ...share, chosen: new Set(sendable.map((p) => p.id)) })}>All</button>
                    <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setShare({ ...share, chosen: new Set() })}>None</button>
                  </div>
                  <ul style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: 170, overflowY: "auto", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "2px 10px" }}>
                    {preview.people.filter((p) => !p.skip && `${p.name} ${p.company} ${p.email}`.toLowerCase().includes((share.q || "").trim().toLowerCase())).map((p) => (
                      <li key={p.id}>
                        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, padding: "3px 2px", cursor: "pointer", minWidth: 0 }}>
                          <input type="checkbox" style={{ accentColor: TEAL }} checked={share.chosen.has(p.id)}
                            onChange={(ev) => { const n = new Set(share.chosen); if (ev.target.checked) n.add(p.id); else n.delete(p.id); setShare({ ...share, chosen: n }); }} />
                          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.email}>{p.name || p.company}{p.name && p.company ? <span style={muted}> · {p.company}</span> : null}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  {preview.people.some((p) => p.skip) ? <div style={{ ...muted, fontSize: 11.5, marginTop: 6 }}>{preview.people.filter((p) => p.skip).length} left out: no email, duplicate, or do-not-contact.</div> : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {open ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "12px 14px 14px", borderTop: `1px solid ${C.border}`, background: "#FBFDFC" }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={busy === "refresh"} onClick={refresh}>
              <RefreshCw size={13} /> {busy === "refresh" ? "Checking…" : "Check the networks for comments"}
            </button>
            <span style={{ ...muted, fontSize: 12 }}>Only people who commented or replied in public are listed. Tick them, then add them to your leads.</span>
          </div>
          {!data ? <Loader compact label="Loading" /> : !data.engagers.length ? (
            <div style={{ ...muted, background: "#fff", border: `1px dashed ${C.border}`, borderRadius: 10, padding: 12 }}>
              Nobody yet. Press <b>Check the networks for comments</b>. Some networks do not share who commented, so you can also add someone by hand below.
            </div>
          ) : (
            <>
              <div style={{ ...muted, fontSize: 12, fontWeight: 600 }}>{people} {people === 1 ? "person" : "people"}</div>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                {data.engagers.map((e) => (
                  <li key={e.id}>
                    <label style={{ display: "flex", gap: 10, alignItems: "flex-start", ...text, fontSize: 13, background: "#fff", border: `1px solid ${picked.has(e.id) ? TEAL : C.border}`, borderRadius: 10, padding: "8px 10px", cursor: e.lead_id ? "default" : "pointer" }}>
                      <input type="checkbox" style={{ marginTop: 3, accentColor: TEAL }} disabled={Boolean(e.lead_id)} checked={picked.has(e.id)}
                        onChange={(ev) => setPicked((p) => { const n = new Set(p); if (ev.target.checked) n.add(e.id); else n.delete(e.id); return n; })} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                          <b>{e.name || e.handle}</b>
                          {e.network && e.network !== "manual" ? <NetworkChip id={e.network} /> : <span style={{ ...muted, fontSize: 11.5 }}>Added by hand</span>}
                          {e.lead_id ? <span style={{ fontSize: 11, fontWeight: 700, color: TEAL_INK }}>Already a lead</span> : null}
                        </span>
                        {e.text ? <span style={{ ...muted, display: "block", overflowWrap: "anywhere", marginTop: 2 }}>“{e.text}”</span> : null}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {data.can_add_to_leads ? (
                  <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" disabled={!picked.size || busy === "list"} onClick={() => toList(false)}>
                    <UserPlus size={13} /> Add {picked.size || ""} to my leads
                  </button>
                ) : <Locked link="social_audience" what="Turning people into leads" />}
                {data.can_add_to_leads && calls.available ? (
                  <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={!picked.size || busy === "list"} title="Adds them as leads, then shows who has a number to call" onClick={() => toList(true)}>
                    <Phone size={13} /> Add and call
                  </button>
                ) : null}
              </div>
            </>
          )}
          <details>
            <summary style={{ ...muted, cursor: "pointer", fontWeight: 600, color: C.ink }}>Add someone by hand</summary>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
              <input className="ui-input" aria-label="Name" style={{ flex: "1 1 140px" }} placeholder="Name" value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} />
              <input className="ui-input" aria-label="Company" style={{ flex: "1 1 140px" }} placeholder="Company" value={manual.company} onChange={(e) => setManual({ ...manual, company: e.target.value })} />
              <input className="ui-input" aria-label="What they said" style={{ flex: "2 1 200px" }} placeholder="What they said" value={manual.text} onChange={(e) => setManual({ ...manual, text: e.target.value })} />
              <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={!manual.name.trim() || busy === "hand"} onClick={addHand}>Add</button>
            </div>
          </details>
        </div>
      ) : null}
      {call ? <CallDialog target={call} onToast={toast} onClose={() => setCall(null)} /> : null}
    </article>
  );
}

function IdeaCard({ icon, title, about, lockLink, lockWhat, children }) {
  return (
    <section style={{ ...card, padding: 16, display: "flex", flexDirection: "column", gap: 12 }} aria-label={title}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <IconBadge icon={icon} />
        <div style={{ minWidth: 0 }}>
          <h3 style={h3}>{title}</h3>
          <div style={{ ...muted, fontSize: 12 }}>{about}</div>
        </div>
      </div>
      <Locked link={lockLink} what={lockWhat} />
      {children}
    </section>
  );
}

function IdeaRow({ title, why, tag, busy, onDraft, label = "Write a draft" }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 0", borderTop: `1px solid ${C.border}` }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...text, fontSize: 13, fontWeight: 600, color: C.ink }}>{title}</div>
        <div style={{ ...muted, fontSize: 12 }}>{tag ? <b style={{ color: TEAL_INK, fontWeight: 600 }}>{tag} · </b> : null}{why}</div>
      </div>
      <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" style={{ flexShrink: 0 }} disabled={busy} onClick={onDraft}>
        <Sparkles size={13} /> {busy ? "Making…" : label}
      </button>
    </div>
  );
}

function Ideas({ toast, onDrafted, onOpenApprovals }) {
  const topics = useConnection("social_audience");
  const voice = useConnection("objections_to_posts");
  const [ideas, setIdeas] = useState(null);
  const [objections, setObjections] = useState(null);
  const [times, setTimes] = useState(null);
  const [events, setEvents] = useState(null);
  const [meetings, setMeetings] = useState(null);
  const [ev, setEv] = useState({ slug: "", when: "" });
  const [busy, setBusy] = useState("");
  useEffect(() => { if (topics.available) { api.getTopicIdeas().then((r) => setIdeas(r.ideas)).catch(() => setIdeas([])); } }, [topics.available]);
  useEffect(() => {
    if (!voice.available) return;
    api.getObjections().then((r) => setObjections(r)).catch(() => setObjections({ objections: [], calls: 0 }));
    api.getBestTimes().then((r) => setTimes(r)).catch(() => setTimes(null));
    api.getCalcomEventTypes().then((r) => setEvents(Array.isArray(r) ? r : r.eventTypes || [])).catch(() => setEvents([]));
    api.getMeetings().then((r) => setMeetings((r || []).filter((m) => !/health check|test/i.test(m.prospect || "")).slice(0, 6))).catch(() => setMeetings([]));
  }, [voice.available]);
  const [made, setMade] = useState(null);
  // Every idea becomes a real draft in Approvals; the AI then writes it, which takes a minute or two.
  const make = async (key, fn, what) => {
    setBusy(key);
    try {
      const r = await fn();
      setMade({ what, ai: r && r.ai ? r.ai : { started: false, why: "" } });
      if (onDrafted) onDrafted();
    } catch (e) { toast(e.message || "Couldn't make the draft."); } finally { setBusy(""); }
  };
  const draft = (title, why, postId) => make(`i:${title}`, () => api.makeTopicPost(title, why, postId), "Your draft");
  return (
    <>
    {made ? (
      <div role="status" style={{ ...card, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14, background: TEAL_SOFT, borderColor: "#C7E9E3", padding: "10px 14px" }}>
        <span style={{ ...text, flex: "1 1 260px", minWidth: 0, color: C.ink, fontSize: 13 }}>
          <b>{made.what} is in Approvals.</b>{" "}
          {made.ai.started ? "The AI is writing it now; it usually takes a minute or two, and the text appears there when it is ready."
            : (made.ai.why ? `The AI did not start: ${made.ai.why} The draft has a starting text you can edit.` : "It has a starting text you can edit.")}
        </span>
        <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" onClick={onOpenApprovals}>Open Post approve</button>
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setMade(null)}>Dismiss</button>
      </div>
    ) : null}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))", gap: 14, alignItems: "start" }}>
      <IdeaCard icon={Lightbulb} title="From the companies you target" about="Fresh each day, from how your posts did, what people said under them, and the industries and towns of your saved companies. Topics you posted lately are left out."
        lockLink="social_audience" lockWhat="Ideas from your leads">
        {topics.available ? (!ideas ? <Loader compact label="Loading" /> : !ideas.length ? (
          <div style={muted}>Save companies in Lead Gen with an industry and a town, and ideas appear here.</div>
        ) : (
          <div>
            {ideas.map((i) => (
              <IdeaRow key={i.title} title={i.title} why={i.why} tag={{ town: "Town", sector: "Industry", best_post: "Your best post", engagement: "Your audience" }[i.kind] || "Idea"}
                busy={busy === `i:${i.title}`} onDraft={() => draft(i.title, i.why, i.post_id)} />
            ))}
          </div>
        )) : null}
      </IdeaCard>

      <IdeaCard icon={MessageCircle} title="From what people say on your calls" about="Questions and doubts that come up again and again on your calls, turned into posts that answer them."
        lockLink="objections_to_posts" lockWhat="Ideas from your calls">
        {voice.available ? (!objections ? <Loader compact label="Loading" /> : !objections.objections.length ? (
          <div style={{ ...muted, background: HUB_PAPER, borderRadius: 10, padding: 12 }}>
            {objections.calls ? `Looked at ${objections.calls} call${objections.calls === 1 ? "" : "s"} from the last ${objections.days} days. ` : "No calls yet. "}
            {objections.calls && !objections.talked
              ? "In none of them did the other person say anything (no answer, voicemail or test calls), so there is nothing to learn from yet. "
              : objections.talked ? `${objections.talked} had a real conversation, but none raised a common doubt (price, timing, an existing supplier, how it works, trust, results or contracts). ` : ""}
            Ideas appear here as soon as one is heard on a call.
          </div>
        ) : (
          <div>
            {objections.objections.map((o) => (
              <IdeaRow key={o.key} title={o.label} why={o.angle} tag={`${o.calls} call${o.calls === 1 ? "" : "s"}`}
                busy={busy === o.key} onDraft={() => make(o.key, () => api.makeObjectionPost(o.key), "Your draft")} />
            ))}
          </div>
        )) : null}
      </IdeaCard>

      <IdeaCard icon={CalendarDays} title="Announce an event" about="A post with a sign-up link to one of your booking events, so people can book straight from it."
        lockLink="event_post" lockWhat="Event posts">
        {voice.available ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ ...muted, fontWeight: 600, color: C.ink, display: "flex", flexDirection: "column" }}>Event
              <select className="ui-input" style={{ marginTop: 4, width: "100%" }} value={ev.slug} onChange={(e) => setEv({ ...ev, slug: e.target.value })}>
                <option value="">Your longest event</option>
                {(events || []).map((t) => <option key={t.slug || t.id} value={t.slug}>{t.title}</option>)}
              </select>
            </label>
            <label style={{ ...muted, fontWeight: 600, color: C.ink, display: "flex", flexDirection: "column" }}>When (optional)
              <input className="ui-input" style={{ marginTop: 4, width: "100%" }} placeholder="e.g. every Tuesday in November" maxLength={80} value={ev.when} onChange={(e) => setEv({ ...ev, when: e.target.value })} />
            </label>
            <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" style={{ alignSelf: "flex-start" }} disabled={busy === "event"}
              onClick={() => make("event", () => api.makeEventPost(ev), "Your event post")}>
              <Sparkles size={13} /> {busy === "event" ? "Making…" : "Write the event post"}
            </button>
          </div>
        ) : null}
      </IdeaCard>

      <IdeaCard icon={Users} title="Thank people after a meeting" about="A short thank-you post after a recent meeting. It never names anyone; add a name only if they have said you may."
        lockLink="objections_to_posts" lockWhat="Meeting thank-you posts">
        {voice.available ? (
          <div>
            {times?.suggestions?.length ? (
              <div style={{ marginBottom: 6 }}>
                <div style={{ ...muted, fontSize: 12, fontWeight: 600, color: C.ink }}>Good times to post (they do not clash with your meetings)</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                  {times.suggestions.map((s) => (
                    <span key={`${s.day}${s.time}`} style={{ fontSize: 12, fontWeight: 600, color: TEAL_INK, background: TEAL_SOFT, borderRadius: 99, padding: "3px 10px" }}>{s.day} {s.time}</span>
                  ))}
                </div>
              </div>
            ) : null}
            {!(meetings || []).length ? <div style={{ ...muted, marginTop: 6 }}>No recent meetings yet.</div> : meetings.map((m) => (
              <IdeaRow key={m.id} title={m.prospect || "A meeting"} why={m.date ? `Met ${when(m.date + "T12:00:00")}` : ""} label="Write a thank-you"
                busy={busy === m.id} onDraft={() => make(m.id, () => api.makeRecapPost(m.id, false), "Your thank-you post")} />
            ))}
          </div>
        ) : null}
      </IdeaCard>
    </div>
    </>
  );
}

export function SocialConnect({ showToast, onDrafted, onOpenApprovals }) {
  const [posts, setPosts] = useState(null);
  const [lists, setLists] = useState([]);
  const [credit, setCredit] = useState(null);
  const [tab, setTab] = useState("audience");
  const leads = useConnection("social_audience");
  const booking = useConnection("post_booking_link");
  useEffect(() => {
    api.getPosts().then((r) => setPosts((r || []).filter((p) => p.status === "published" || p.status === "posted")
      .sort((a, b) => String(b.publishedAt || "").localeCompare(String(a.publishedAt || ""))))).catch(() => setPosts([]));
  }, []);
  useEffect(() => { if (leads.available) api.listLeadLists().then((r) => setLists(r.lists || [])).catch(() => setLists([])); }, [leads.available]);
  useEffect(() => { if (booking.available) api.getBookingCredit().then(setCredit).catch(() => setCredit(null)); }, [booking.available]);
  const meetingsBy = useMemo(() => Object.fromEntries(((credit && credit.posts) || []).map((p) => [p.post_id, p.meetings])), [credit]);
  const totalMeetings = Object.values(meetingsBy).reduce((a, b) => a + (b || 0), 0);

  const tabs = [
    { id: "audience", label: "Who engaged", icon: Users, count: posts ? posts.length : null },
    { id: "ideas", label: "Post ideas", icon: Lightbulb },
  ];
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "22px 28px 48px", background: HUB_PAPER }}>
      <div style={{ maxWidth: 1320, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ ...card, background: TEAL_SOFT, borderColor: "#C7E9E3", padding: "14px 16px", display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ flex: "1 1 360px", minWidth: 0 }}>
            <div style={{ ...text, fontWeight: 700, fontSize: 14, color: TEAL_INK }}>Turn your posts into customers</div>
            <div style={{ ...muted, color: C.ink }}>
              See who commented on your posts and add them to your leads, copy a booking link that credits meetings to a post, and get ideas for what to post next.
            </div>
          </div>
          {booking.available ? (
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 24, color: TEAL_INK, fontVariantNumeric: "tabular-nums" }}>{totalMeetings}</div>
              <div style={{ ...muted, fontSize: 12 }}>meetings booked from posts</div>
            </div>
          ) : null}
        </div>

        <div role="tablist" aria-label="Audience and ideas" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {tabs.map((t) => {
            const on = tab === t.id;
            const Icon = t.icon;
            return (
              <button key={t.id} type="button" role="tab" aria-selected={on} onClick={() => setTab(t.id)}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10, cursor: "pointer", fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13,
                  border: `1px solid ${on ? "#12141C" : C.border}`, background: on ? "#12141C" : "#fff", color: on ? "#fff" : "#12141C" }}>
                <Icon size={14} /> {t.label}
                {t.count != null ? <span style={{ fontSize: 11, borderRadius: 99, padding: "0 7px", background: on ? "rgba(255,255,255,0.22)" : HUB_PAPER, color: on ? "#fff" : C.slate }}>{t.count}</span> : null}
              </button>
            );
          })}
        </div>

        {tab === "audience" ? (
          <section role="tabpanel" aria-label="Who engaged" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Locked link="social_audience" what="Turning people into leads" />
            <Locked link="post_booking_link" what="Booking links on posts" />
            {!posts ? <Loader compact label="Loading" /> : !posts.length ? (
              <div style={{ ...card, padding: 28, textAlign: "center", borderStyle: "dashed" }}>
                <Users size={22} color={C.slate} aria-hidden="true" />
                <div style={{ fontWeight: 700, marginTop: 8, ...text }}>No published posts yet</div>
                <div style={{ ...muted, marginTop: 4 }}>Once a post goes live, it shows here and you can see who engaged with it.</div>
              </div>
            ) : posts.map((p) => <PostRow key={p.id} post={p} toast={showToast} lists={lists} meetings={meetingsBy[p.id] || 0} />)}
          </section>
        ) : (
          <section role="tabpanel" aria-label="Post ideas">
            <Ideas toast={showToast} onDrafted={onDrafted} onOpenApprovals={onOpenApprovals} />
          </section>
        )}
      </div>
    </div>
  );
}
