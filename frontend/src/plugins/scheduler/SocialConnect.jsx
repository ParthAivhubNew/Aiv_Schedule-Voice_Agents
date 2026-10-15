import React, { useCallback, useEffect, useState } from "react";
import { CalendarDays, Lock, Mail, Phone, RefreshCw, Users } from "lucide-react";
import { api } from "../../api/apiClient";
import { C, FONT_BODY, FONT_DISPLAY } from "../../tokens";
import { missingNames, openPlans, useConnection } from "../../hooks/useConnections";
import { CallDialog } from "../leadgen/CallFlow";

// Social working with Leads and Voice: who engaged with a post (and turning them into leads), a booking link that credits
// meetings to a post, sharing a post with a list, and post ideas from your leads and your calls.

const text = { fontFamily: FONT_BODY };
const muted = { ...text, fontSize: 12.5, color: C.slate, lineHeight: 1.5 };
const heading = { fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink, margin: 0 };

function Locked({ link, what }) {
  const { available, missing, loading } = useConnection(link);
  if (loading || available) return null;
  return (
    <div style={{ ...muted, display: "flex", gap: 8, alignItems: "center", background: C.paperSoft, borderRadius: 8, padding: "8px 10px", flexWrap: "wrap" }}>
      <Lock size={13} /> {what} needs {missingNames(missing)}.
      <button type="button" className="ui-link" onClick={() => openPlans(missing[0])}>See plans</button>
    </div>
  );
}

function PostRow({ post, toast, lists }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [busy, setBusy] = useState("");
  const [bookings, setBookings] = useState(null);
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
  useEffect(() => { if (booking.available) api.getPostBookings(post.id).then(setBookings).catch(() => setBookings(null)); }, [booking.available, post.id]);

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
    const r = await api.sharePostToList(post.id, share.listId, share.note);
    toast(`Draft campaign made for ${r.people} ${r.people === 1 ? "person" : "people"}${r.skipped ? ` (${r.skipped} skipped)` : ""}. Check it under Campaigns in Lead Gen, then start it.`);
    setShare(null);
  });

  const results = (post.publishResults || []).filter((r) => r.ok);
  return (
    <div className="ui-card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.ink, overflowWrap: "anywhere" }}>{post.title || "Untitled post"}</div>
          <div style={muted}>{(post.channels || []).join(", ")}{post.publishedAt ? ` · ${post.publishedAt}` : ""}{bookings ? ` · ${bookings.count} meeting${bookings.count === 1 ? "" : "s"} booked from it` : ""}</div>
        </div>
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setOpen((v) => !v)}><Users size={13} /> Who engaged</button>
        {booking.available ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={busy === "link"} title="A page where people pick a time. Meetings booked through it are credited to this post" onClick={link}><CalendarDays size={13} /> Booking link</button> : null}
        {leads.available && results.length ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" title="Email a short note with this post's link to one of your lists" onClick={() => setShare({ listId: lists[0]?.id || "", note: "" })}><Mail size={13} /> Share with a list</button> : null}
      </div>
      {share ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select className="ui-input" style={{ width: "auto" }} value={share.listId} onChange={(e) => setShare({ ...share, listId: e.target.value })}>
            {lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.ids.length})</option>)}
          </select>
          <input className="ui-input" style={{ flex: 1, minWidth: 200 }} placeholder="A line to go with it (optional)" maxLength={300} value={share.note} onChange={(e) => setShare({ ...share, note: e.target.value })} />
          <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" disabled={!share.listId || busy === "share"} onClick={doShare}>Make a draft campaign</button>
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setShare(null)}>Cancel</button>
        </div>
      ) : null}
      {open ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={busy === "refresh"} onClick={refresh}><RefreshCw size={13} /> Check the networks</button>
            <span style={muted}>Only people who engaged in public are listed.</span>
          </div>
          {!data ? <div style={muted}>Loading…</div> : !data.engagers.length ? <div style={muted}>Nobody yet. Some networks don't share who commented, so you can also add people by hand below.</div> : (
            <>
              {data.engagers.map((e) => (
                <label key={e.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", ...text, fontSize: 13 }}>
                  <input type="checkbox" disabled={Boolean(e.lead_id)} checked={picked.has(e.id)} onChange={(ev) => setPicked((p) => { const n = new Set(p); if (ev.target.checked) n.add(e.id); else n.delete(e.id); return n; })} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <b>{e.name || e.handle}</b> <span style={muted}>{e.network} · {e.kind}{e.lead_id ? " · already a lead" : ""}</span>
                    {e.text ? <span style={{ ...muted, display: "block", overflowWrap: "anywhere" }}>{e.text}</span> : null}
                  </span>
                </label>
              ))}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {data.can_add_to_leads ? (
                  <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" disabled={!picked.size || busy === "list"} onClick={() => toList(false)}>Add {picked.size || ""} to my leads</button>
                ) : <Locked link="social_audience" what="Turning people into leads" />}
                {data.can_add_to_leads && calls.available ? (
                  <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={!picked.size || busy === "list"} title="Adds them as leads, then shows who has a number to call" onClick={() => toList(true)}><Phone size={13} /> Add and call</button>
                ) : null}
              </div>
            </>
          )}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <input className="ui-input" style={{ flex: "1 1 140px" }} placeholder="Name" value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} />
            <input className="ui-input" style={{ flex: "1 1 140px" }} placeholder="Company" value={manual.company} onChange={(e) => setManual({ ...manual, company: e.target.value })} />
            <input className="ui-input" style={{ flex: "2 1 200px" }} placeholder="What they said" value={manual.text} onChange={(e) => setManual({ ...manual, text: e.target.value })} />
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={!manual.name.trim() || busy === "hand"} onClick={addHand}>Add by hand</button>
          </div>
        </div>
      ) : null}
      {call ? <CallDialog target={call} onToast={toast} onClose={() => setCall(null)} /> : null}
    </div>
  );
}

function Ideas({ toast }) {
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
    api.getMeetings().then((r) => setMeetings((r || []).slice(0, 6))).catch(() => setMeetings([]));
  }, [voice.available]);
  const make = async (key, fn, done) => {
    setBusy(key);
    try { await fn(); toast(done); } catch (e) { toast(e.message || "Couldn't make the draft."); } finally { setBusy(""); }
  };
  const draft = (title, why) => make(`i:${title}`, () => api.createPost({ id: `post_${Math.random().toString(36).slice(2, 10)}`, title, copy: `${title}\n\n[Write your post here. ${why}]`, channels: ["linkedin"], status: "awaiting_approval", slotDateMs: Date.now() + 2 * 86400000, time: "10:00", theme: "Ideas" }), "A draft is waiting under Approvals.");
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: 14 }}>
      <section className="ui-card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        <h3 style={{ ...heading, fontSize: 14.5 }}>Ideas from the companies you target</h3>
        <Locked link="social_audience" what="Ideas from your leads" />
        {topics.available ? (!ideas ? <div style={muted}>Loading…</div> : !ideas.length ? <div style={muted}>Save companies in Lead Gen with an industry and a town, and ideas appear here.</div> : ideas.map((i) => (
          <div key={i.title} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ ...text, fontSize: 13, fontWeight: 600, color: C.ink }}>{i.title}</div><div style={muted}>{i.why}</div></div>
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={busy === `i:${i.title}`} onClick={() => draft(i.title, i.why)}>Draft</button>
          </div>
        ))) : null}
      </section>
      <section className="ui-card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        <h3 style={{ ...heading, fontSize: 14.5 }}>What people say on your calls</h3>
        <Locked link="objections_to_posts" what="Ideas from your calls" />
        {voice.available ? (!objections ? <div style={muted}>Loading…</div> : !objections.objections.length ? <div style={muted}>Nothing repeated yet across {objections.calls} calls.</div> : objections.objections.map((o) => (
          <div key={o.key} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ ...text, fontSize: 13, fontWeight: 600, color: C.ink }}>{o.label} · {o.calls} call{o.calls === 1 ? "" : "s"}</div><div style={muted}>{o.angle}</div></div>
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={busy === o.key} onClick={() => make(o.key, () => api.makeObjectionPost(o.key), "A draft is waiting under Approvals.")}>Draft a post</button>
          </div>
        ))) : null}
      </section>
      <section className="ui-card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        <h3 style={{ ...heading, fontSize: 14.5 }}>Announce an event</h3>
        <Locked link="event_post" what="Event posts" />
        {voice.available ? (
          <>
            <select className="ui-input" value={ev.slug} onChange={(e) => setEv({ ...ev, slug: e.target.value })}>
              <option value="">Your longest event</option>
              {(events || []).map((t) => <option key={t.slug || t.id} value={t.slug}>{t.title}</option>)}
            </select>
            <input className="ui-input" placeholder="When, in your words (optional)" maxLength={80} value={ev.when} onChange={(e) => setEv({ ...ev, when: e.target.value })} />
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" style={{ alignSelf: "flex-start" }} disabled={busy === "event"} onClick={() => make("event", () => api.makeEventPost(ev), "A draft with a sign-up link is waiting under Approvals.")}>Make the post</button>
          </>
        ) : null}
      </section>
      <section className="ui-card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        <h3 style={{ ...heading, fontSize: 14.5 }}>After a meeting, and when to post</h3>
        <Locked link="objections_to_posts" what="Meeting recaps and best times" />
        {voice.available ? (
          <>
            {times?.suggestions?.length ? <div style={muted}>Times that miss your meetings: {times.suggestions.map((s) => `${s.day} ${s.time}`).join(", ")}.</div> : null}
            {(meetings || []).map((m) => (
              <div key={m.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ ...text, fontSize: 13, flex: 1 }}>{m.prospect} · {m.date}</span>
                <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={busy === m.id} title="A thank-you draft that doesn't name them" onClick={() => make(m.id, () => api.makeRecapPost(m.id, false), "A thank-you draft is waiting under Approvals.")}>Thank-you post</button>
              </div>
            ))}
            <div style={muted}>The draft doesn't name anyone. Add a name only if they've said you may.</div>
          </>
        ) : null}
      </section>
    </div>
  );
}

export function SocialConnect({ showToast }) {
  const [posts, setPosts] = useState(null);
  const [lists, setLists] = useState([]);
  const [credit, setCredit] = useState(null);
  const leads = useConnection("social_audience");
  const booking = useConnection("post_booking_link");
  useEffect(() => {
    api.getPosts().then((r) => setPosts((r || []).filter((p) => p.status === "published" || p.status === "posted"))).catch(() => setPosts([]));
  }, []);
  useEffect(() => { if (leads.available) api.listLeadLists().then((r) => setLists(r.lists || [])).catch(() => setLists([])); }, [leads.available]);
  useEffect(() => { if (booking.available) api.getBookingCredit().then(setCredit).catch(() => setCredit(null)); }, [booking.available]);
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "22px 28px 48px", display: "flex", flexDirection: "column", gap: 18 }}>
      <div>
        <h1 style={{ ...heading, fontSize: 22 }}>Audience & ideas</h1>
        <div style={{ ...muted, fontSize: 13 }}>See who engaged with your posts, turn them into leads, link posts to meetings, and get post ideas from your leads and calls.</div>
      </div>
      <Locked link="social_audience" what="Turning people into leads" />
      <Locked link="post_booking_link" what="Booking links on posts" />
      {credit?.posts?.length ? (
        <section className="ui-card" style={{ padding: 14 }}>
          <h3 style={{ ...heading, fontSize: 14.5 }}>Meetings your posts brought in</h3>
          {credit.posts.map((p) => <div key={p.post_id} style={{ ...text, fontSize: 13, marginTop: 4 }}><b>{p.meetings}</b> · {p.title || p.post_id}</div>)}
        </section>
      ) : null}
      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 style={{ ...heading, fontSize: 15 }}>Your published posts</h2>
        {!posts ? <div style={muted}>Loading…</div> : !posts.length ? <div style={muted}>Posts you publish appear here, with who engaged with each.</div> : posts.map((p) => <PostRow key={p.id} post={p} toast={showToast} lists={lists} />)}
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 style={{ ...heading, fontSize: 15 }}>Ideas</h2>
        <Ideas toast={showToast} />
      </section>
    </div>
  );
}
