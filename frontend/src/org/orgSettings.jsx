import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "../api/apiClient";

// Organisation-wide time settings. Every screen formats and picks dates in the
// organisation timezone, never the browser's, so a user abroad sees the same schedule.

export const ORG_UPDATED_EVENT = "aivhub_org_updated";

const DEFAULT_ORG = { timezone: "Europe/London", weekStart: "monday", timeFormat: "24h", approverEmails: [] };

const OrgContext = createContext(DEFAULT_ORG);

export function OrgSettingsProvider({ children }) {
  const [org, setOrg] = useState(DEFAULT_ORG);

  const load = useCallback(() => {
    api.getOrgSettings()
      .then((res) => { if (res && res.timezone) setOrg({ ...DEFAULT_ORG, ...res }); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(ORG_UPDATED_EVENT, load);
    return () => window.removeEventListener(ORG_UPDATED_EVENT, load);
  }, [load]);

  return <OrgContext.Provider value={org}>{children}</OrgContext.Provider>;
}

export function useOrg() {
  return useContext(OrgContext);
}

export function announceOrgUpdated() {
  try { window.dispatchEvent(new Event(ORG_UPDATED_EVENT)); } catch (_) {}
}

const pad = (n) => String(n).padStart(2, "0");

// Wall-clock parts of an instant in a timezone.
function partsIn(ms, tz) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const p = {};
  fmt.formatToParts(new Date(ms)).forEach((x) => { p[x.type] = x.value; });
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

function offsetMs(ms, tz) {
  const p = partsIn(ms, tz);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

/** "YYYY-MM-DD" + "HH:MM" in tz -> epoch ms (daylight-saving aware). */
export function orgInstant(dateStr, timeStr, tz) {
  const [y, mo, d] = String(dateStr || "").split("-").map((v) => parseInt(v, 10));
  const [hh, mm] = String(timeStr || "09:00").split(":").map((v) => parseInt(v, 10));
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return NaN;
  const wall = Date.UTC(y, mo - 1, d, Number.isFinite(hh) ? hh : 9, Number.isFinite(mm) ? mm : 0);
  let guess = wall - offsetMs(wall, tz);
  guess = wall - offsetMs(guess, tz);
  return guess;
}

/** Epoch ms -> { date: "YYYY-MM-DD", time: "HH:MM" } in tz. */
export function orgDateTime(ms, tz) {
  const p = partsIn(ms, tz);
  return { date: `${p.y}-${pad(p.mo)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.mi)}` };
}

export function orgToday(tz) {
  return orgDateTime(Date.now(), tz).date;
}

/** "HH:MM" -> "HH:MM" or "h:MM AM" per the organisation time format. */
export function formatOrgTime(hhmm, timeFormat) {
  const [h, m] = String(hhmm || "").split(":").map((v) => parseInt(v, 10));
  if (!Number.isFinite(h)) return hhmm || "";
  if (timeFormat !== "12h") return `${pad(h)}:${pad(Number.isFinite(m) ? m : 0)}`;
  const suffix = h >= 12 ? "PM" : "AM";
  return `${((h + 11) % 12) + 1}:${pad(Number.isFinite(m) ? m : 0)} ${suffix}`;
}

/** Short label such as "GMT+5:30 (Asia/Kolkata)". */
export function tzLabel(tz) {
  try {
    const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" })
      .formatToParts(new Date()).find((x) => x.type === "timeZoneName");
    return `${name ? name.value : ""} (${tz})`.trim();
  } catch (_) {
    return tz;
  }
}
