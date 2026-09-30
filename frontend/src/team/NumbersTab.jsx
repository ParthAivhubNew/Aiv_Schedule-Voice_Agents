import React, { useCallback, useEffect, useState } from "react";
import { Phone, Plus, Star, Trash2 } from "lucide-react";
import { C, FONT_BODY, FONT_MONO } from "../tokens";
import { api } from "../api/apiClient";

const input = { padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: FONT_BODY, background: "#fff", boxSizing: "border-box" };
const btn = (primary) => ({
  display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 9, cursor: "pointer",
  border: primary ? "none" : `1px solid ${C.border}`, background: primary ? C.ink : "#fff", color: primary ? "#fff" : C.textInk,
  fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600,
});

// The organisation's phone numbers and who may call from each.
// A number with nobody assigned is shared by everyone who can make calls.
export function NumbersTab() {
  const [numbers, setNumbers] = useState([]);
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ e164: "", label: "", assistant_id: "" });
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const [n, u] = await Promise.all([api.getNumbers(), api.getUsers()]);
      setNumbers(n);
      setUsers(u.filter((x) => x.is_active));
    } catch (err) {
      setError(err.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (fn) => {
    setError("");
    try {
      setNumbers(await fn());
    } catch (err) {
      setError(err.message || "Something went wrong.");
    }
  };

  const toggleUser = (n, userId) => {
    const next = n.assignedTo.includes(userId) ? n.assignedTo.filter((x) => x !== userId) : [...n.assignedTo, userId];
    act(() => api.assignNumber(n.id, next));
  };

  return (
    <div style={{ fontFamily: FONT_BODY }}>
      <div style={{ fontSize: 12.5, color: C.slate, marginBottom: 12 }}>
        Tick people to reserve a number for them. A number with nobody ticked can be used by everyone who makes calls.
        The default number is used when someone has no number of their own.
      </div>
      {error && <div style={{ color: C.red, background: C.redSoft, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, marginBottom: 12 }}>{error}</div>}
      <div style={{ display: "grid", gap: 10 }}>
        {numbers.length === 0 && <div style={{ fontSize: 13, color: C.slate }}>No numbers saved yet.</div>}
        {numbers.map((n) => (
          <div key={n.id} style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <Phone size={16} color={C.cobalt} />
              <span style={{ fontFamily: FONT_MONO, fontSize: 14, fontWeight: 600 }}>{n.e164}</span>
              <input
                defaultValue={n.label}
                placeholder="Label, e.g. Sales line"
                onBlur={(e) => e.target.value !== n.label && act(() => api.updateNumber(n.id, { label: e.target.value }))}
                style={{ ...input, width: 180 }}
              />
              {n.isDefault ? (
                <span style={{ fontSize: 11.5, fontWeight: 700, color: C.cobaltDeep, background: C.cobaltSoft, padding: "3px 8px", borderRadius: 6 }}>Default</span>
              ) : (
                <button type="button" style={btn(false)} onClick={() => act(() => api.updateNumber(n.id, { is_default: true }))}>
                  <Star size={13} /> Make default
                </button>
              )}
              <span style={{ fontSize: 12, color: n.shared ? C.teal : C.slate }}>{n.shared ? "Shared with everyone" : `Reserved for ${n.assignedTo.length}`}</span>
              <div style={{ flex: 1 }} />
              <button type="button" title="Remove number" style={btn(false)} onClick={() => act(() => api.deleteNumber(n.id))}>
                <Trash2 size={13} />
              </button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: C.slate, width: 110 }}>AI assistant ID</span>
              <input
                defaultValue={n.assistantId}
                placeholder="Optional: Telnyx assistant for this line"
                onBlur={(e) => e.target.value !== n.assistantId && act(() => api.updateNumber(n.id, { assistant_id: e.target.value }))}
                style={{ ...input, flex: 1, minWidth: 220, fontFamily: FONT_MONO, fontSize: 12 }}
              />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
              {users.map((u) => {
                const on = n.assignedTo.includes(u.id);
                return (
                  <label key={u.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, border: `1px solid ${on ? C.cobalt : C.border}`, background: on ? C.cobaltSoft : "#fff", borderRadius: 8, padding: "4px 10px", cursor: "pointer" }}>
                    <input type="checkbox" checked={on} onChange={() => toggleUser(n, u.id)} />
                    {u.name}
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {adding ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            act(async () => {
              const out = await api.addNumber({ e164: form.e164, label: form.label, assistant_id: form.assistant_id });
              setForm({ e164: "", label: "", assistant_id: "" });
              setAdding(false);
              return out;
            });
          }}
          style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginTop: 12, display: "grid", gap: 10, background: C.paper }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <input style={input} placeholder="+44 20 7946 0000" value={form.e164} onChange={(e) => setForm({ ...form, e164: e.target.value })} />
            <input style={input} placeholder="Label (optional)" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          </div>
          <input style={input} placeholder="Telnyx assistant ID for this line (optional)" value={form.assistant_id} onChange={(e) => setForm({ ...form, assistant_id: e.target.value })} />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" style={btn(false)} onClick={() => setAdding(false)}>Cancel</button>
            <button type="submit" style={btn(true)}>Save number</button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setAdding(true)} style={{ ...btn(false), width: "100%", justifyContent: "center", marginTop: 12, borderStyle: "dashed" }}>
          <Plus size={14} /> Add a number
        </button>
      )}
    </div>
  );
}
