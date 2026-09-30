import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Copy, RefreshCw } from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY } from "../../../tokens";
import { api } from "../../../api/apiClient";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const time = { height: 34, borderRadius: 8, border: `1px solid ${C.border}`, padding: "0 8px", fontFamily: FONT_BODY, fontSize: 13, background: "#fff" };
const card = { background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 18 };
const pill = (on) => ({
  padding: "7px 12px", borderRadius: 9, border: `1px solid ${on ? C.ink : C.border}`, background: on ? C.ink : "#fff",
  color: on ? "#fff" : C.textInk, fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: FONT_BODY,
});

function mins(t) {
  const [h, m] = String(t || "0:0").split(":").map((x) => parseInt(x, 10) || 0);
  return h * 60 + m;
}

// One row per weekday: open/closed + from/to. Weekends can be opened like any other day.
function WeekGrid({ days, onChange, disabled }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {DAYS.map((d) => {
        const spec = days[d] || { open: false, start: "09:00", end: "17:30" };
        const bad = spec.open && mins(spec.end) <= mins(spec.start);
        return (
          <div key={d} style={{ display: "grid", gridTemplateColumns: "120px 90px 1fr", alignItems: "center", gap: 10, opacity: disabled ? 0.55 : 1 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.textInk }}>{d}</span>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: disabled ? "default" : "pointer" }}>
              <input type="checkbox" disabled={disabled} checked={spec.open} onChange={(e) => onChange(d, { ...spec, open: e.target.checked })} />
              {spec.open ? "Open" : "Closed"}
            </label>
            {spec.open ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="time" aria-label={`${d} from`} disabled={disabled} value={spec.start} onChange={(e) => onChange(d, { ...spec, start: e.target.value })} style={time} />
                <span style={{ color: C.slate, fontSize: 12.5 }}>to</span>
                <input type="time" aria-label={`${d} to`} disabled={disabled} value={spec.end} onChange={(e) => onChange(d, { ...spec, end: e.target.value })} style={time} />
                {bad && <span style={{ color: C.red, fontSize: 12 }}>End must be after start</span>}
              </div>
            ) : <span style={{ fontSize: 12.5, color: C.slateLight }}>No work this day</span>}
          </div>
        );
      })}
    </div>
  );
}

function LunchRow({ lunch, onChange, disabled }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap", opacity: disabled ? 0.55 : 1 }}>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
        <input type="checkbox" disabled={disabled} checked={lunch.on} onChange={(e) => onChange({ ...lunch, on: e.target.checked })} />
        Lunch break
      </label>
      {lunch.on && (
        <>
          <input type="time" aria-label="Lunch from" disabled={disabled} value={lunch.start} onChange={(e) => onChange({ ...lunch, start: e.target.value })} style={time} />
          <span style={{ color: C.slate, fontSize: 12.5 }}>to</span>
          <input type="time" aria-label="Lunch to" disabled={disabled} value={lunch.end} onChange={(e) => onChange({ ...lunch, end: e.target.value })} style={time} />
        </>
      )}
    </div>
  );
}

function meetingDaysFromSettings(st) {
  const open = st.working_days || ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  const byDay = st.working_hours_by_day || {};
  const out = {};
  DAYS.forEach((d) => {
    const spec = byDay[d] || {};
    out[d] = { open: open.includes(d), start: spec.start || st.working_hours_start || "09:00", end: spec.end || st.working_hours_end || "17:30" };
  });
  return out;
}

// Working hours for the whole organisation: when calls may go out, and when meetings can be booked.
export function WorkingHoursTab({ operator }) {
  const canEdit = Boolean(operator?.is_admin || operator?.permissions?.company === "full");
  const [rules, setRules] = useState(null);
  const [meet, setMeet] = useState(null);
  const [meetLunch, setMeetLunch] = useState({ on: true, start: "12:00", end: "13:00" });
  const [saving, setSaving] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [r, cal] = await Promise.all([api.getCompliance(), api.getCalcomSettings().catch(() => null)]);
      setRules(r);
      const st = (cal && (cal.settings || cal)) || {};
      setMeet(meetingDaysFromSettings(st));
      const ls = st.lunch_start || "12:00";
      const le = st.lunch_end || "13:00";
      setMeetLunch({ on: ls !== le, start: ls, end: ls !== le ? le : "13:00" });
    } catch (err) {
      setError(err.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const flash = (t) => {
    setMsg(t);
    setTimeout(() => setMsg(""), 2500);
  };

  const saveCalls = async () => {
    setSaving("calls");
    setError("");
    try {
      setRules(await api.saveCompliance({ mode: rules.mode, policy: rules.policy, schedule: rules.schedule }));
      flash("Calling hours saved");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving("");
    }
  };

  const saveMeetings = async () => {
    setSaving("meet");
    setError("");
    try {
      const open = DAYS.filter((d) => meet[d].open);
      const byDay = Object.fromEntries(DAYS.map((d) => [d, { start: meet[d].start, end: meet[d].end }]));
      await api.saveCalcomSettings({
        working_days: open,
        working_hours_by_day: byDay,
        lunch_start: meetLunch.on ? meetLunch.start : "12:00",
        lunch_end: meetLunch.on ? meetLunch.end : "12:00",
      });
      flash("Meeting hours saved");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving("");
    }
  };

  if (!rules || !meet) {
    return <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate }}>{error || "Loading working hours…"}</div>;
  }
  const custom = rules.policy === "custom";
  const weekendCalls = custom && (rules.schedule.days.Saturday.open || rules.schedule.days.Sunday.open);
  const lateCalls = custom && DAYS.some((d) => rules.schedule.days[d].open && (mins(rules.schedule.days[d].start) < mins("08:00") || mins(rules.schedule.days[d].end) > mins("21:00")));

  return (
    <div style={{ fontFamily: FONT_BODY, display: "grid", gap: 16, maxWidth: 860 }}>
      {!canEdit && <div style={{ fontSize: 12.5, color: C.slate }}>You can view these hours. Only admins or people with Company profile: Full access can change them.</div>}
      {error && <div style={{ color: C.red, background: C.redSoft, padding: "8px 12px", borderRadius: 8, fontSize: 13 }}>{error}</div>}
      {msg && <div style={{ color: C.green, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}><Check size={14} /> {msg}</div>}

      <div style={card}>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16 }}>Calling hours</div>
        <div style={{ fontSize: 12.5, color: C.slate, margin: "4px 0 14px" }}>
          When the AI may call people, in each person's own time zone. Numbers that opted out are never called.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {[["respectful", "Weekdays (company hours)"], ["legal", "Every day 08:00–21:00"], ["custom", "Custom days and hours"]].map(([k, l]) => (
            <button key={k} type="button" disabled={!canEdit} onClick={() => setRules({ ...rules, policy: k })} style={pill(rules.policy === k)}>{l}</button>
          ))}
        </div>
        <WeekGrid
          days={rules.schedule.days}
          disabled={!canEdit || !custom}
          onChange={(d, spec) => setRules({ ...rules, schedule: { ...rules.schedule, days: { ...rules.schedule.days, [d]: spec } } })}
        />
        <LunchRow lunch={rules.schedule.lunch} disabled={!canEdit || !custom} onChange={(l) => setRules({ ...rules, schedule: { ...rules.schedule, lunch: l } })} />
        {!custom && <div style={{ fontSize: 12, color: C.slate, marginTop: 8 }}>Choose “Custom days and hours” to edit the days above.</div>}
        {(weekendCalls || lateCalls) && (
          <div style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 12.5, color: C.amber, marginTop: 10 }}>
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            UK guidance (Ofcom) is to avoid marketing calls before 08:00 and after 21:00; weekend calls are allowed but can annoy people. It is your choice.
          </div>
        )}
        <div style={{ borderTop: `1px solid ${C.borderLight}`, marginTop: 16, paddingTop: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>When a call falls outside these hours</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[["warn", "Call, but warn"], ["block", "Don't call"], ["off", "Ignore the hours"]].map(([k, l]) => (
              <button key={k} type="button" disabled={!canEdit} onClick={() => setRules({ ...rules, mode: k })} style={pill(rules.mode === k)}>{l}</button>
            ))}
          </div>
        </div>
        {canEdit && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <button type="button" onClick={saveCalls} disabled={saving === "calls"} style={{ ...pill(true), display: "inline-flex", alignItems: "center", gap: 6 }}>
              {saving === "calls" && <RefreshCw size={13} className="animate-spin" />} Save calling hours
            </button>
          </div>
        )}
      </div>

      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16 }}>Meeting hours</div>
            <div style={{ fontSize: 12.5, color: C.slate, marginTop: 4 }}>When the AI may book meetings, in the company time zone ({rules.timezone}).</div>
          </div>
          {canEdit && (
            <button
              type="button"
              style={{ ...pill(false), display: "inline-flex", alignItems: "center", gap: 6 }}
              onClick={() => { setMeet(JSON.parse(JSON.stringify(rules.schedule.days))); setMeetLunch({ ...rules.schedule.lunch }); }}
            >
              <Copy size={13} /> Same as calling hours
            </button>
          )}
        </div>
        <div style={{ marginTop: 14 }}>
          <WeekGrid days={meet} disabled={!canEdit} onChange={(d, spec) => setMeet({ ...meet, [d]: spec })} />
          <LunchRow lunch={meetLunch} disabled={!canEdit} onChange={setMeetLunch} />
        </div>
        {canEdit && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <button type="button" onClick={saveMeetings} disabled={saving === "meet"} style={{ ...pill(true), display: "inline-flex", alignItems: "center", gap: 6 }}>
              {saving === "meet" && <RefreshCw size={13} className="animate-spin" />} Save meeting hours
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
