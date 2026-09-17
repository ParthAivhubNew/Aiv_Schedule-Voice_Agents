import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import {
  Calendar,
  Headphones,
  History,
  LayoutGrid,
  List,
  LogOut,
  PhoneCall,
  PhoneOff,
  Radio,
  Settings2,
  Upload,
} from "lucide-react";
import { AppChrome } from "../components/AppChrome";
import { api } from "../api/apiClient";
import { AudioStreamPlayer } from "../api/audioStreamPlayer";
import { C, FONT_BODY, FONT_DISPLAY } from "../tokens";
import { setCallingEdition } from "./callingEdition";

const PAGES = [
  { id: "list", label: "List", icon: List },
  { id: "live", label: "Live", icon: Radio },
  { id: "booked", label: "Booked", icon: Calendar },
  { id: "setup", label: "Setup", icon: Settings2 },
];

const EXTRA_SLOTS = ["Phone", "Email", "Website", "LinkedIn", "Contact"];
const SIMPLE_PAGES = new Set(["list", "live", "booked", "setup"]);

function digitsInPhone(raw) {
  return String(raw || "").replace(/\D/g, "");
}

function looksLikeUrl(v) {
  const s = String(v || "").trim();
  if (!s) return false;
  return /^https?:\/\//i.test(s) || /^www\./i.test(s);
}

function pickHeader(headers, re) {
  return (headers || []).find((h) => re.test(String(h || ""))) || "";
}

function parseSpreadsheetFile(file, onDone, onError) {
  const ext = String(file.name || "").split(".").pop().toLowerCase();
  if (ext === "csv") {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        onDone({ headers: results.meta.fields || [], records: results.data || [] });
      },
      error: (err) => onError(err.message || "Could not read CSV file"),
    });
    return;
  }
  if (ext === "xlsx" || ext === "xls") {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const records = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        const headers = records.length ? Object.keys(records[0]) : [];
        onDone({ headers, records });
      } catch (_) {
        onError("Could not read spreadsheet — check the file isn't corrupted");
      }
    };
    reader.onerror = () => onError("Could not read file");
    reader.readAsArrayBuffer(file);
    return;
  }
  onError("Unsupported file type — upload a .csv, .xlsx, or .xls file");
}

function extraHeaders(fileHeaders) {
  const lower = (fileHeaders || []).map((h) => String(h || "").toLowerCase());
  return EXTRA_SLOTS.filter((slot) => {
    const re = {
      Phone: /phone|mobile|tel/,
      Email: /e-?mail/,
      Website: /website|homepage|url/,
      LinkedIn: /linkedin/,
      Contact: /contact|person|first.?name/,
    }[slot];
    return !lower.some((h) => re.test(h));
  });
}

function rowFromRecord(headers, rec, i) {
  const nameH = pickHeader(headers, /company|account|organisation|organization/) || headers[0] || "";
  const personH = pickHeader(headers, /contact|person|full.?name|first.?name/) || "";
  const phoneH = pickHeader(headers, /phone|mobile|tel/) || "";
  const emailH = pickHeader(headers, /e-?mail/) || "";
  const webH = pickHeader(headers, /website|homepage|url/) || "";
  const liH = pickHeader(headers, /linkedin/) || "";
  const company = String((nameH && rec[nameH]) || "").trim();
  const contact = String((personH && rec[personH]) || "").trim();
  const phone = String((phoneH && rec[phoneH]) || "").trim();
  return {
    id: "row_" + i,
    company,
    contact,
    name: company || contact || `Row ${i + 1}`,
    phone,
    email: String((emailH && rec[emailH]) || "").trim(),
    website: String((webH && rec[webH]) || "").trim(),
    linkedin: String((liH && rec[liH]) || "").trim(),
    cells: rec,
  };
}

function missingKeys(r) {
  const miss = [];
  if (!String(r.phone || "").trim()) miss.push("phone");
  if (!String(r.email || "").trim()) miss.push("email");
  if (!String(r.website || "").trim()) miss.push("website");
  if (!String(r.linkedin || "").trim()) miss.push("linkedin");
  if (!String(r.contact || "").trim()) miss.push("contact");
  if (!String(r.company || "").trim()) miss.push("company");
  return miss;
}

function serializeForGaps(list) {
  return (list || []).map((r) => ({
    id: r.id,
    name: r.company || r.name || "",
    contact: r.contact || "",
    phone: r.phone || "",
    email: r.email || "",
    source: looksLikeUrl(r.website) ? r.website : "",
    linkedin: looksLikeUrl(r.linkedin) ? r.linkedin : "",
  }));
}

function applyFill(r, fill) {
  if (!fill || fill.status !== "proposed") return r;
  const next = { ...r };
  if (!String(r.phone || "").trim() && fill.phone) next.phone = fill.phone;
  if (!String(r.email || "").trim() && fill.email) next.email = fill.email;
  if (!String(r.contact || "").trim() && fill.contact) next.contact = fill.contact;
  const site = fill.website || fill.source;
  if (!String(r.website || "").trim() && looksLikeUrl(site)) next.website = site;
  if (!String(r.linkedin || "").trim() && looksLikeUrl(fill.linkedin)) next.linkedin = fill.linkedin;
  if (!String(r.company || "").trim() && fill.company) {
    next.company = fill.company;
    next.name = fill.company;
  }
  return next;
}

function liveActive(c) {
  const st = String(c.state || c.status || "").toLowerCase();
  return !c.ended && st !== "ended" && st !== "failed" && st !== "canceled";
}

function navBtn(active) {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    margin: "0 4px",
    padding: "10px 12px",
    borderRadius: 10,
    border: "none",
    background: active ? "#1E2230" : "transparent",
    color: "#fff",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    textAlign: "left",
  };
}

function fieldStyle() {
  return {
    width: "100%",
    height: 38,
    borderRadius: 8,
    border: `1px solid ${C.border}`,
    padding: "0 10px",
    fontFamily: FONT_BODY,
    fontSize: 13,
  };
}

export function CallingWorkspace({
  operator,
  onBackToHub,
  onLogout,
  profile,
  setProfile,
  onUseClassic,
}) {
  const [page, setPage] = useState(() => {
    try {
      const hash = window.location.hash.replace(/^#\/?/, "");
      const parts = hash.split("/");
      if (parts[0] === "voice" && SIMPLE_PAGES.has(parts[1])) return parts[1];
    } catch (_) {}
    return "list";
  });
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [concurrency, setConcurrency] = useState(1);
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [liveCalls, setLiveCalls] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [listeningId, setListeningId] = useState(null);
  const [takenId, setTakenId] = useState(null);
  const [voiceName, setVoiceName] = useState("rex");
  const [draft, setDraft] = useState({
    name: (profile && profile.name) || "",
    pitch: (profile && profile.pitch) || "",
    website: (profile && profile.website) || "",
    callerId: (profile && profile.callerId) || "",
    timezone: (profile && profile.timezone) || "Europe/London",
  });
  const fileRef = useRef(null);
  const playerRef = useRef(null);
  const lookupStop = useRef(false);

  const extras = useMemo(() => extraHeaders(headers), [headers]);

  useEffect(() => {
    try {
      const target = `#/voice/${page}`;
      if (window.location.hash !== target) window.history.replaceState(null, "", target);
    } catch (_) {}
  }, [page]);

  useEffect(() => {
    setDraft({
      name: (profile && profile.name) || "",
      pitch: (profile && profile.pitch) || "",
      website: (profile && profile.website) || "",
      callerId: (profile && profile.callerId) || "",
      timezone: (profile && profile.timezone) || "Europe/London",
    });
  }, [profile]);

  useEffect(() => {
    api.getTelephonyHub()
      .then((res) => {
        const vid = res?.voice?.voice_id;
        if (vid) setVoiceName(vid);
      })
      .catch(() => {});
  }, []);

  const showToast = (t) => {
    setToast(t);
    window.setTimeout(() => setToast(""), 4200);
  };

  const refreshLive = useCallback(async () => {
    try {
      const data = await api.getLiveCalls();
      const list = Array.isArray(data) ? data : data?.calls || [];
      setLiveCalls(list);
    } catch (_) {}
  }, []);

  const refreshMeetings = useCallback(async () => {
    try {
      const data = await api.getMeetings();
      setMeetings(Array.isArray(data) ? data : data?.meetings || []);
    } catch (_) {}
  }, []);

  useEffect(() => {
    refreshLive();
    refreshMeetings();
    const t = window.setInterval(() => {
      refreshLive();
      if (page === "booked") refreshMeetings();
    }, 4000);
    return () => window.clearInterval(t);
  }, [page, refreshLive, refreshMeetings]);

  useEffect(() => {
    return () => {
      if (playerRef.current) {
        try { playerRef.current.stopListening(); } catch (_) {}
        playerRef.current = null;
      }
    };
  }, []);

  const onFile = (file) => {
    if (!file) return;
    parseSpreadsheetFile(
      file,
      ({ headers: hs, records }) => {
        setFileName(file.name);
        setHeaders(hs);
        setRows((records || []).map((rec, i) => rowFromRecord(hs, rec, i)));
        showToast(`${records.length} rows from file. Empty extra columns stay blank until Find missing.`);
      },
      (err) => showToast(err)
    );
  };

  const findMissing = async () => {
    const pool = rows.filter((r) => missingKeys(r).length && (r.company || r.contact || r.name));
    if (!pool.length) {
      showToast("Nothing missing on rows that have a name.");
      return;
    }
    lookupStop.current = false;
    setBusy("find");
    const CHUNK = 2;
    try {
      for (let i = 0; i < pool.length; i += CHUNK) {
        if (lookupStop.current) break;
        const slice = pool.slice(i, i + CHUNK);
        const res = await api.fillContactGaps({ contacts: serializeForGaps(slice), max_rows: CHUNK });
        const fills = (res && res.fills) || [];
        setRows((prev) => prev.map((r) => {
          const fill = fills.find((f) => String(f.id) === String(r.id));
          return fill ? applyFill(r, fill) : r;
        }));
      }
      showToast("Find missing finished. Filled empty file fields only.");
    } catch (e) {
      showToast(e.message || "Find missing failed");
    } finally {
      setBusy("");
    }
  };

  const startCalls = async () => {
    const prospects = rows
      .filter((r) => digitsInPhone(r.phone).length >= 7)
      .map((r) => ({
        to_number: r.phone,
        phone: r.phone,
        prospect_name: r.contact || r.name,
        name: r.company || r.name,
        contact: r.contact || r.name,
        website: r.website || "",
      }));
    if (!prospects.length) {
      showToast("No dialable phone numbers on this list.");
      return;
    }
    const cap = Math.max(1, Math.min(Number(concurrency) || 1, 5));
    setBusy("dial");
    try {
      const res = await api.dialOutboundBatch({
        prospects,
        concurrency: cap,
        mission_title: fileName ? `List — ${fileName}` : `Outbound list — ${prospects.length} contacts`,
        from_number: (profile && profile.callerId) || undefined,
        timezone: (profile && profile.timezone) || "Europe/London",
      });
      showToast(res.message || `Live outbound started for ${res.total} contacts.`);
      setPage("live");
      await refreshLive();
    } catch (e) {
      showToast(e.message || "Dial failed");
    } finally {
      setBusy("");
    }
  };

  const stopListen = async (id) => {
    if (playerRef.current) {
      try { playerRef.current.stopListening(); } catch (_) {}
      playerRef.current = null;
    }
    setListeningId(null);
    setTakenId(null);
    if (id) {
      try { await api.toggleListen(id); } catch (_) {}
    }
  };

  const toggleListen = async (id) => {
    if (listeningId === id) {
      await stopListen(id);
      return;
    }
    if (playerRef.current) await stopListen(listeningId);
    const player = new AudioStreamPlayer(id, (status) => {
      if (!status.listening) {
        setListeningId(null);
        setTakenId(null);
      }
    }, () => {});
    player.startListening();
    playerRef.current = player;
    setListeningId(id);
    try { await api.toggleListen(id); } catch (_) {}
  };

  const toggleTakeover = async (id) => {
    if (takenId === id) {
      if (playerRef.current) {
        try { playerRef.current.stopMicrophone(); } catch (_) {}
      }
      setTakenId(null);
      try { await api.toggleTakeover(id); } catch (_) {}
      return;
    }
    if (listeningId !== id) await toggleListen(id);
    if (playerRef.current) {
      const ok = await playerRef.current.startMicrophone();
      if (!ok) {
        showToast("Microphone permission is required to speak on the call.");
        return;
      }
      setTakenId(id);
      try { await api.toggleTakeover(id); } catch (_) {}
    }
  };

  const endCall = async (id) => {
    try {
      await api.endLiveCall(id);
      if (listeningId === id) await stopListen(id);
      await refreshLive();
    } catch (e) {
      showToast(e.message || "End failed");
    }
  };

  const saveSetup = async () => {
    setBusy("save");
    try {
      const next = { ...(profile || {}), ...draft };
      await api.updateProfile(next);
      if (setProfile) setProfile(next);
      await api.selectVoice({ voice_id: voiceName, label: voiceName === "rex" ? "Rex (Sam / male)" : voiceName, provider: "xai" });
      showToast("Setup saved.");
    } catch (e) {
      showToast(e.message || "Save failed");
    } finally {
      setBusy("");
    }
  };

  const activeLive = liveCalls.filter(liveActive);
  const dialable = rows.filter((r) => digitsInPhone(r.phone).length >= 7).length;

  return (
    <div style={{ display: "flex", height: "100vh", background: C.paper, fontFamily: FONT_BODY }}>
      <AppChrome />
      <div style={{ width: 228, minWidth: 228, background: C.ink, height: "100vh", display: "flex", flexDirection: "column", padding: "18px 12px", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 8px 12px" }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: C.teal, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <PhoneCall size={15} color="#fff" />
          </div>
          <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: "#fff" }}>Calling</span>
        </div>
        <button type="button" onClick={onBackToHub} style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 4px 14px", padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.inkLine}`, background: "transparent", color: "#C8CCD6", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
          <LayoutGrid size={14} /> All plugins
        </button>
        {PAGES.map((p) => {
          const Icon = p.icon;
          return (
            <button key={p.id} type="button" onClick={() => setPage(p.id)} style={navBtn(page === p.id)}>
              <Icon size={15} />
              <span style={{ flex: 1 }}>{p.label}</span>
              {p.id === "live" && activeLive.length ? (
                <span style={{ minWidth: 18, height: 18, borderRadius: 99, background: C.teal, color: "#fff", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>
                  {activeLive.length}
                </span>
              ) : null}
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => {
            setCallingEdition("classic");
            try { window.history.replaceState(null, "", "#/voice/tasks"); } catch (_) {}
            if (onUseClassic) onUseClassic();
          }}
          style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 4px 4px", padding: "8px 10px", borderRadius: 8, border: "none", background: "transparent", color: "#C8CCD6", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
        >
          <History size={14} /> Use classic calling
        </button>
        <button type="button" onClick={onLogout} style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 4px", padding: "8px 10px", borderRadius: 8, border: "none", background: "transparent", color: "#8B90A0", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
          <LogOut size={14} /> Log out
        </button>
      </div>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "18px 28px 12px", borderBottom: `1px solid ${C.border}`, background: "#fff" }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22, color: C.textInk }}>
            {page === "list" && "Today's list"}
            {page === "live" && "Live calls"}
            {page === "booked" && "Booked"}
            {page === "setup" && "Setup"}
          </div>
          <div style={{ fontSize: 13, color: C.slate, marginTop: 4 }}>
            {page === "list" && "Upload file. Call. Find missing only fills empty cells."}
            {page === "live" && "Listen or take over. Status from live API, not the local queue."}
            {page === "booked" && "Meetings the agent booked. Join URL from calendar, not a fake Meet link."}
            {page === "setup" && "Company name, caller ID, Sam voice (Rex)."}
          </div>
        </div>

        {toast ? (
          <div style={{ margin: "12px 28px 0", padding: "10px 12px", borderRadius: 8, background: C.cobaltSoft, color: C.cobaltDeep, fontSize: 13 }}>{toast}</div>
        ) : null}

        <div style={{ flex: 1, overflow: "auto", padding: "18px 28px 28px" }}>
          {page === "list" && (
            <div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
                <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" hidden onChange={(e) => onFile(e.target.files && e.target.files[0])} />
                <button type="button" onClick={() => fileRef.current && fileRef.current.click()} style={{ height: 38, padding: "0 14px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
                  <Upload size={14} /> {fileName || "Upload CSV / Excel"}
                </button>
                <label style={{ fontSize: 13, color: C.slate, display: "flex", alignItems: "center", gap: 8 }}>
                  Lines at once
                  <select value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))} style={{ ...fieldStyle(), width: 72, height: 36 }}>
                    {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <span style={{ fontSize: 12, color: C.slateLight }}>Cap 5. Quality band, not a guarantee.</span>
                <button type="button" disabled={!rows.length || busy === "find"} onClick={findMissing} style={{ height: 38, padding: "0 14px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", fontWeight: 600, cursor: rows.length ? "pointer" : "default" }}>
                  {busy === "find" ? "Looking…" : "Find missing"}
                </button>
                {busy === "find" ? (
                  <button type="button" onClick={() => { lookupStop.current = true; }} style={{ height: 38, padding: "0 12px", borderRadius: 8, border: "none", background: C.paperSoft, cursor: "pointer" }}>Stop</button>
                ) : null}
                <button
                  type="button"
                  disabled={!dialable || busy === "dial"}
                  onClick={startCalls}
                  style={{ height: 38, padding: "0 16px", borderRadius: 8, border: "none", background: C.ink, color: "#fff", fontWeight: 700, cursor: dialable ? "pointer" : "default" }}
                >
                  {busy === "dial" ? "Placing…" : `Call ${dialable || 0}`}
                </button>
              </div>

              {!rows.length ? (
                <div style={{ padding: 48, textAlign: "center", color: C.slate, border: `1px dashed ${C.border}`, borderRadius: 12, background: "#fff" }}>
                  Drop a list. Columns come from the file. Extra empty columns appear only if those fields were not in the header row.
                </div>
              ) : (
                <div style={{ overflow: "auto", border: `1px solid ${C.border}`, borderRadius: 12, background: "#fff" }}>
                  <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
                    <thead>
                      <tr>
                        {headers.map((h) => (
                          <th key={h} style={{ textAlign: "left", padding: "10px 12px", borderBottom: `1px solid ${C.border}`, color: C.slate, fontWeight: 700, whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                        {extras.map((h) => (
                          <th key={"x_" + h} style={{ textAlign: "left", padding: "10px 12px", borderBottom: `1px solid ${C.border}`, color: C.slateLight, fontWeight: 700, whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id}>
                          {headers.map((h) => (
                            <td key={h} style={{ padding: "8px 12px", borderBottom: `1px solid ${C.borderLight}`, color: C.textInk }}>{String((r.cells && r.cells[h]) != null ? r.cells[h] : "")}</td>
                          ))}
                          {extras.map((h) => {
                            const key = h.toLowerCase() === "contact" ? "contact" : h.toLowerCase();
                            const val = r[key] || "";
                            return (
                              <td key={"x_" + h} style={{ padding: "8px 12px", borderBottom: `1px solid ${C.borderLight}`, color: val ? C.textInk : C.slateLight }}>
                                {val || ""}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {page === "live" && (
            <div style={{ display: "grid", gap: 10 }}>
              {!activeLive.length ? (
                <div style={{ padding: 48, textAlign: "center", color: C.slate, border: `1px dashed ${C.border}`, borderRadius: 12, background: "#fff" }}>
                  No live PSTN calls. Start from List.
                </div>
              ) : activeLive.map((c) => {
                const id = c.id || c.call_sid;
                const name = c.prospect || c.prospect_name || c.contact || c.name || "Unknown";
                const st = c.state || c.status || "calling";
                return (
                  <div key={id} style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                    <div>
                      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16 }}>{name}</div>
                      <div style={{ fontSize: 12, color: C.slate, marginTop: 4 }}>{st} · {c.to_number || c.phone || ""}</div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button type="button" onClick={() => toggleListen(id)} style={{ height: 36, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.border}`, background: listeningId === id ? C.tealSoft : "#fff", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                        <Headphones size={14} /> {listeningId === id ? "Listening" : "Listen"}
                      </button>
                      <button type="button" onClick={() => toggleTakeover(id)} style={{ height: 36, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.border}`, background: takenId === id ? C.amberSoft : "#fff", cursor: "pointer", fontWeight: 600 }}>
                        {takenId === id ? "Release" : "Take over"}
                      </button>
                      <button type="button" onClick={() => endCall(id)} style={{ height: 36, padding: "0 12px", borderRadius: 8, border: "none", background: C.redSoft, color: C.red, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                        <PhoneOff size={14} /> End
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {page === "booked" && (
            <div style={{ display: "grid", gap: 10 }}>
              {!meetings.length ? (
                <div style={{ padding: 48, textAlign: "center", color: C.slate, border: `1px dashed ${C.border}`, borderRadius: 12, background: "#fff" }}>
                  No bookings yet.
                </div>
              ) : meetings.map((m) => {
                const join = m.videoLink || m.videoCallUrl || m.join_url || m.meetingUrl || "";
                const when = [m.date, m.time].filter(Boolean).join(" ") || m.start || m.when || "";
                return (
                  <div key={m.id} style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700 }}>{m.prospect || m.attendee || m.title || "Meeting"}</div>
                    <div style={{ fontSize: 12, color: C.slate, marginTop: 4 }}>{when}{m.status ? ` · ${m.status}` : ""}</div>
                    {join ? (
                      <a href={join} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 10, color: C.cobalt, fontWeight: 600, fontSize: 13 }}>{join}</a>
                    ) : (
                      <div style={{ marginTop: 8, fontSize: 12, color: C.slateLight }}>No join URL yet.</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {page === "setup" && (
            <div style={{ maxWidth: 520, display: "grid", gap: 12 }}>
              {[
                ["name", "Company name"],
                ["pitch", "Pitch (spoken as AIVHub, one word)"],
                ["website", "Website"],
                ["callerId", "Caller ID"],
                ["timezone", "Timezone"],
              ].map(([k, label]) => (
                <label key={k} style={{ fontSize: 12, fontWeight: 700, color: C.slate }}>
                  {label}
                  {k === "pitch" ? (
                    <textarea value={draft[k]} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} rows={4} style={{ ...fieldStyle(), height: "auto", padding: 10, marginTop: 6, resize: "vertical" }} />
                  ) : (
                    <input value={draft[k]} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} style={{ ...fieldStyle(), marginTop: 6 }} />
                  )}
                </label>
              ))}
              <label style={{ fontSize: 12, fontWeight: 700, color: C.slate }}>
                Voice
                <select value={voiceName} onChange={(e) => setVoiceName(e.target.value)} style={{ ...fieldStyle(), marginTop: 6 }}>
                  <option value="rex">Rex — Sam (male)</option>
                  <option value="leo">Leo (male)</option>
                  <option value="ara">Ara (female)</option>
                  <option value="eve">Eve (female)</option>
                </select>
              </label>
              <button type="button" disabled={busy === "save"} onClick={saveSetup} style={{ height: 40, border: "none", borderRadius: 10, background: C.ink, color: "#fff", fontWeight: 700, cursor: "pointer", width: 160 }}>
                {busy === "save" ? "Saving…" : "Save"}
              </button>
              <div style={{ fontSize: 12, color: C.slate }}>Signed in as {operator?.username || operator?.name || "operator"}.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
