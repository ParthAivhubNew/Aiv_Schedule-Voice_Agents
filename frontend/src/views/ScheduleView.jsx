import React, { useState } from "react";
import { Calendar, PlusCircle, Clock, Quote, CheckCircle2, AlertTriangle, X } from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../tokens";
import { TopBar } from "../components/TopBar";
import { Badge } from "../components/Badges";

export function ScheduleCallModal({ onClose, onCreate }) {
  const [prospect, setProspect] = useState("");
  const [mission, setMission] = useState("Logistics — Manchester");
  const [day, setDay] = useState("Tomorrow");
  const [time, setTime] = useState("10:00");
  const [quote, setQuote] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!prospect.trim()) return;
    onCreate({
      prospect: prospect.trim(),
      mission,
      day,
      time,
      window: "09:00–17:30",
      status: "queued",
      honored: quote.trim().length > 0,
      honoredQuote: quote.trim() || null,
    });
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(18,20,28,0.45)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 460, background: "#FFFFFF", borderRadius: 20, border: `1px solid ${C.border}`, padding: 28, boxShadow: "0 24px 60px rgba(0,0,0,0.15)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.ink }}>Schedule Callback</div>
          <button onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", color: C.slate }}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Prospect Company</label>
            <input type="text" value={prospect} onChange={(e) => setProspect(e.target.value)} required placeholder="e.g. Manchester Transport Group" style={{ width: "100%", height: 40, padding: "0 12px", borderRadius: 10 }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Day</label>
              <input type="text" value={day} onChange={(e) => setDay(e.target.value)} style={{ width: "100%", height: 40, padding: "0 12px", borderRadius: 10 }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Time</label>
              <input type="text" value={time} onChange={(e) => setTime(e.target.value)} style={{ width: "100%", height: 40, padding: "0 12px", borderRadius: 10 }} />
            </div>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Exact Requested Quote (Optional)</label>
            <input type="text" value={quote} onChange={(e) => setQuote(e.target.value)} placeholder="e.g. Call me Monday morning" style={{ width: "100%", height: 40, padding: "0 12px", borderRadius: 10 }} />
          </div>
          <button type="submit" style={{ height: 44, borderRadius: 11, border: "none", background: C.cobalt, color: "#fff", fontWeight: 600, cursor: "pointer", marginTop: 8 }}>
            Add to Schedule
          </button>
        </form>
      </div>
    </div>
  );
}

export function ScheduleView({ notifications, setNotifications, items = [], onCreateItem }) {
  const [showModal, setShowModal] = useState(false);

  return (
    <div style={{ flex: 1, overflowY: "auto", background: C.paper }}>
      <TopBar
        title="Schedule"
        subtitle="Planned outbound call slots, retries, and honored callback requests."
        notifications={notifications}
        setNotifications={setNotifications}
      />

      <div style={{ padding: 32 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.ink }}>
            Upcoming Call Timetable ({items.length})
          </div>
          <button
            onClick={() => setShowModal(true)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              height: 38,
              padding: "0 16px",
              borderRadius: 10,
              border: "none",
              background: C.cobalt,
              color: "#fff",
              fontFamily: FONT_BODY,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <PlusCircle size={15} /> Schedule Call
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {items.map((it) => (
            <div
              key={it.id}
              style={{
                background: "#FFFFFF",
                borderRadius: 16,
                border: `1px solid ${C.border}`,
                padding: "18px 22px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                boxShadow: C.shadowCard,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
                <div
                  style={{
                    width: 80,
                    padding: "8px 10px",
                    borderRadius: 10,
                    background: C.paperSoft,
                    textAlign: "center",
                    border: `1px solid ${C.borderLight}`,
                  }}
                >
                  <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slate, fontWeight: 600 }}>{it.day}</div>
                  <div style={{ fontFamily: FONT_MONO, fontSize: 14.5, color: C.ink, fontWeight: 700, marginTop: 2 }}>{it.time}</div>
                </div>

                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 15, color: C.ink }}>
                      {it.prospect}
                    </span>
                    {it.honored && (
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: C.teal, background: C.tealSoft, padding: "2px 7px", borderRadius: 4 }}>
                        HONORED CALLBACK
                      </span>
                    )}
                  </div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, marginTop: 3 }}>
                    {it.mission} · Window: {it.window}
                  </div>
                  {it.honoredQuote && (
                    <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.cobaltDeep, marginTop: 4, fontStyle: "italic" }}>
                      “{it.honoredQuote}”
                    </div>
                  )}
                </div>
              </div>

              <Badge status={it.status} />
            </div>
          ))}
        </div>
      </div>

      {showModal && (
        <ScheduleCallModal
          onClose={() => setShowModal(false)}
          onCreate={(newItem) => {
            if (onCreateItem) onCreateItem(newItem);
          }}
        />
      )}
    </div>
  );
}
