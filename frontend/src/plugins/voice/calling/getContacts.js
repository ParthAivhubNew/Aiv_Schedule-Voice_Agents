// Get contacts on a call list. No screens here, so it can be tested on its own.

// What each row sends to be saved as a Leads company. `key` brings the answer back to the row.
export function linkRowsFor(rows, phoneOf) {
  return rows.map((r) => ({
    key: r.id, lead_id: r.leadId || "", name: r.company || r.name || "", website: r.website || "", phone: phoneOf(r) || "",
    email: r.email || "", contact_name: r.contact || "", region: [r.town, r.postcode].filter(Boolean).join(" "), industry: r.sector || "",
  }));
}

export const pullIds = (rows) => [...new Set(rows.map((r) => r.leadId).filter(Boolean))];

// Puts what Leads now knows onto the rows. A blank is filled; a value the person already has is never replaced.
export function applyPulled(rows, companies) {
  return rows.map((r) => {
    const c = r.leadId && companies[r.leadId];
    if (!c) return r;
    const lead = { verdict: c.verdict || "", group: c.group || "", closed: Boolean(c.closed) };
    const same = r.lead && Object.keys(lead).every((k) => r.lead[k] === lead[k]);
    const next = { ...r, phone: r.phone || c.phone || "", email: r.email || c.email || "", website: r.website || c.website || "", contact: r.contact || c.contact_name || "" };
    const changed = next.phone !== r.phone || next.email !== r.email || next.website !== r.website || next.contact !== r.contact;
    return same && !changed ? r : { ...next, lead };
  });
}
