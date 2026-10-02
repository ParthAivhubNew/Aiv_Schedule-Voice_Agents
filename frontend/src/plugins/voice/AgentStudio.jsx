import React, { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, Pause, PhoneCall, Play, Save, ShieldCheck, UserRound } from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY } from "../../tokens";
import { api } from "../../api/apiClient";
import { BehaviourFields, CompanyVoices, VoiceFields, box, btn, input, label } from "./AssistantOptions";

const title = (Icon, text) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.textInk }}>
    <Icon size={16} color={C.cobalt} /> {text}
  </div>
);

function Message({ msg }) {
  if (!msg.text) return null;
  return <div role={msg.error ? "alert" : "status"} style={{ fontSize: 12.5, color: msg.error ? C.red : C.teal }}>{msg.text}</div>;
}

// Agent Studio: how the AI caller sounds and behaves. Each user picks their voice and adds their
// phone (test calls, taking over calls); admins set the company's rules and which script each
// campaign uses. Scripts themselves are written in AI Templates; knowledge on the Company page.
export function AgentStudio({ onOpenPage }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [me, setMe] = useState({ voice: "", model: "", phone: "", settings: {} });
  const [company, setCompany] = useState(null);
  const [testScript, setTestScript] = useState("");
  const [msg, setMsg] = useState({ me: {}, company: {}, test: {}, campaign: {} });
  const [busy, setBusy] = useState("");
  const [playing, setPlaying] = useState("");
  const audio = useRef(null);

  // part: which form to refresh from the server ("all" on opening). A save never resets the
  // other form, so nothing typed there is lost.
  const load = useCallback(async (part = "all") => {
    try {
      const d = await api.getAgentStudio();
      setData(d);
      if (part === "all" || part === "me") setMe({ voice: d.me.voice, model: d.me.model, phone: d.me.phone, settings: d.me.settings });
      if (part === "all" || part === "company") setCompany({ ...d.company, captureText: (d.company.captureFields || []).join(", ") });
    } catch (err) {
      setError(err.message);
    }
  }, []);
  useEffect(() => { load("all"); }, [load]);
  useEffect(() => () => audio.current && audio.current.pause(), []);

  const say = (key, text, isError = false) => setMsg((m) => ({ ...m, [key]: { text, error: isError } }));
  const run = async (key, fn, ok) => {
    setBusy(key);
    say(key, "");
    try {
      await fn();
      say(key, ok);
      load(key);
    } catch (err) {
      say(key, err.message, true);
    }
    setBusy("");
  };

  // Staff-picked voices carry their own sample; any other voice is read out by Telnyx once and
  // kept on our side, so a preview costs nothing after the first play.
  const play = async (voice) => {
    if (audio.current) audio.current.pause();
    if (playing === voice.id) return setPlaying("");
    say("me", "");
    setPlaying(voice.id);
    try {
      const src = voice.sample || URL.createObjectURL(await api.agentStudioVoicePreview(voice.id));
      audio.current = new Audio(src);
      audio.current.onended = () => setPlaying("");
      await audio.current.play();
    } catch (err) {
      setPlaying("");
      say("me", err.message || "Could not play this voice.", true);
    }
  };

  if (error && !data) return <div role="alert" style={{ color: C.red, fontSize: 13 }}>{error}</div>;
  if (!data || !company) return <div style={{ color: C.slate, fontSize: 13 }}>Loading…</div>;
  const { catalogue, templates, campaigns } = data;
  const outbound = templates.filter((t) => t.direction === "outbound");
  const inbound = templates.filter((t) => t.direction === "inbound");
  const chosenVoice = catalogue.voices.find((v) => v.id === me.voice);
  const status = data.me.assistant;

  // Nothing here does anything until the company has a number to call from.
  if (data.hasNumber === false) {
    return (
      <div style={{ ...box, maxWidth: 640, fontFamily: FONT_BODY }}>
        {title(PhoneCall, "Get a phone number first")}
        <div style={{ fontSize: 13, color: C.slate }}>
          Your assistant's voice, AI model and call rules are set up here once your company has a number to call from.
          {data.canChangeCompany ? "" : " Ask your admin to add one."}
        </div>
        {data.canChangeCompany && onOpenPage && (
          <button type="button" style={btn(true)} onClick={() => onOpenPage("numbers")}>
            <PhoneCall size={13} /> Get a number
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 14, maxWidth: 980, fontFamily: FONT_BODY }}>
      {!data.managed && (
        <div style={{ ...box, background: C.amberSoft, borderColor: C.amber, display: "block", fontSize: 13 }}>
          Your call assistant is being set up by the OutReach team. You can prepare everything here; test calls work once it is on.
        </div>
      )}

      <div style={box}>
        {title(UserRound, "Your assistant")}
        <div style={{ fontSize: 12.5, color: C.slate }}>
          Your calls use your own assistant, whichever of the company's numbers you call from.
          {status && ` Status: ${status.status === "ready" ? "ready" : status.status === "error" ? "needs attention" : "being set up"}.`}
          {status?.error && ` (${status.error})`}
        </div>
        <VoiceFields catalogue={catalogue} me={me} setMe={setMe} effective={data.me.effective} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, alignItems: "end" }}>
          <label style={label}>Your phone (test calls, taking over calls)
            <input aria-label="Your phone" placeholder="+447700900123" value={me.phone} onChange={(e) => setMe({ ...me, phone: e.target.value })} style={input} />
          </label>
          {chosenVoice && (
            <button type="button" aria-label={playing === chosenVoice.id ? "Stop sample" : "Play sample"} onClick={() => play(chosenVoice)} style={btn(false)}>
              {playing === chosenVoice.id ? <Pause size={13} /> : <Play size={13} />} Hear this voice
            </button>
          )}
        </div>
        <button type="button" style={btn(true, busy === "me")} disabled={busy === "me"}
          onClick={() => run("me", () => api.saveAgentStudioMe(me), "Saved. Your next call uses it.")}>
          <Save size={13} /> Save
        </button>
        <Message msg={msg.me} />

        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select aria-label="Script for the test call" value={testScript} onChange={(e) => setTestScript(e.target.value)} style={{ ...input, width: 260 }}>
            <option value="">Default outbound script</option>
            {outbound.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button type="button" style={btn(false, busy === "test" || !data.managed)} disabled={busy === "test" || !data.managed}
            onClick={() => run("test", () => api.agentStudioTestCall(testScript), "Calling your phone now: answer it to hear your assistant.")}>
            <PhoneCall size={13} /> Call my phone
          </button>
          <Message msg={msg.test} />
        </div>
      </div>

      <CompanyVoices clones={data.clones || []} onChanged={() => load("me")} />

      <div style={box}>
        {title(ShieldCheck, "Company rules for every call")}
        {!data.canChangeCompany && <div style={{ fontSize: 12.5, color: C.slate }}>Only admins can change these.</div>}
        <fieldset disabled={!data.canChangeCompany} style={{ border: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
            <label style={label}>Agent's name
              <input aria-label="Agent name" value={company.agentName} onChange={(e) => setCompany({ ...company, agentName: e.target.value })} style={input} />
            </label>
            <label style={label}>Tone
              <input aria-label="Tone" placeholder="Warm, concise, professional" value={company.tone} onChange={(e) => setCompany({ ...company, tone: e.target.value })} style={input} />
            </label>
          </div>
          <label style={label}>Hand over to a person when…
            <textarea aria-label="Hand over when" rows={2} placeholder="they ask about a refund, a complaint, or want to speak to the owner" value={company.handoverWhen}
              onChange={(e) => setCompany({ ...company, handoverWhen: e.target.value })} style={{ ...input, resize: "vertical" }} />
          </label>
          <label style={label}>Never say or promise
            <textarea aria-label="Never say" rows={2} placeholder="discounts over 10%, delivery dates, legal advice" value={company.neverSay}
              onChange={(e) => setCompany({ ...company, neverSay: e.target.value })} style={{ ...input, resize: "vertical" }} />
          </label>
          <label style={label}>Find out on each call (comma separated; shown in call history)
            <input aria-label="Fields to capture" placeholder="email, budget, decision maker, best time to call" value={company.captureText}
              onChange={(e) => setCompany({ ...company, captureText: e.target.value })} style={input} />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
            <label style={label}>Default outbound script
              <select aria-label="Default outbound script" value={company.defaultOutboundTemplateId} onChange={(e) => setCompany({ ...company, defaultOutboundTemplateId: e.target.value })} style={input}>
                <option value="">The active outbound script</option>
                {outbound.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label style={label}>Incoming calls script
              <select aria-label="Incoming calls script" value={company.defaultInboundTemplateId} onChange={(e) => setCompany({ ...company, defaultInboundTemplateId: e.target.value })} style={input}>
                <option value="">The active inbound script</option>
                {inbound.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}>
            <input type="checkbox" aria-label="Record calls" checked={company.recordCalls} onChange={(e) => setCompany({ ...company, recordCalls: e.target.checked })} style={{ marginTop: 3 }} />
            <span>Record calls <span style={{ color: C.slate }}>(off by default; when on, the agent says the notice below first)</span></span>
          </label>
          {company.recordCalls && (
            <label style={label}>Recording notice
              <input aria-label="Recording notice" value={company.disclosure} onChange={(e) => setCompany({ ...company, disclosure: e.target.value })} style={input} />
            </label>
          )}
          <BehaviourFields a={company.assistant} set={(patch) => setCompany({ ...company, assistant: { ...company.assistant, ...patch } })} />
          <button type="button" style={btn(true, busy === "company")} disabled={busy === "company"}
            onClick={() => run("company", () => api.saveAgentStudioCompany({
              agentName: company.agentName, tone: company.tone, handoverWhen: company.handoverWhen, neverSay: company.neverSay,
              captureFields: company.captureText.split(",").map((s) => s.trim()).filter(Boolean), recordCalls: company.recordCalls,
              disclosure: company.disclosure, defaultOutboundTemplateId: company.defaultOutboundTemplateId, defaultInboundTemplateId: company.defaultInboundTemplateId,
              assistant: company.assistant,
            }), "Saved. Every call from now on follows these rules.")}>
            <Save size={13} /> Save company rules
          </button>
        </fieldset>
        <Message msg={msg.company} />
      </div>

      <div style={box}>
        {title(BookOpen, "Script per campaign")}
        <div style={{ fontSize: 12.5, color: C.slate }}>
          Write and edit scripts in <button type="button" onClick={() => onOpenPage && onOpenPage("templates")} style={{ border: "none", background: "none", color: C.cobalt, cursor: "pointer", padding: 0, font: "inherit" }}>AI Templates</button>;
          what the AI knows comes from the <button type="button" onClick={() => onOpenPage && onOpenPage("company")} style={{ border: "none", background: "none", color: C.cobalt, cursor: "pointer", padding: 0, font: "inherit" }}>Company</button> page.
        </div>
        {campaigns.length === 0 ? <div style={{ fontSize: 13, color: C.slate }}>No campaigns yet.</div> : (
          <div style={{ display: "grid", gap: 8 }}>
            {campaigns.map((m) => (
              <div key={m.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ flex: "1 1 200px", fontSize: 13, fontWeight: 600 }}>{m.title}</span>
                <select aria-label={`Script for ${m.title}`} value={m.templateId} style={{ ...input, width: 280 }}
                  onChange={(e) => run("campaign", () => api.setCampaignScript(m.id, e.target.value), `${m.title} now uses that script.`)}>
                  <option value="">Default outbound script</option>
                  {outbound.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            ))}
          </div>
        )}
        <Message msg={msg.campaign} />
      </div>
    </div>
  );
}
