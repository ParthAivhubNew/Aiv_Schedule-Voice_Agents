// What the Summary tab shows, worked out from the company profile and the saved company. No screens here.
import { niceName, personName, shortDate } from "./companyLogic";

const GOOD = new Set(["ok", "verified", "found"]);

// Where a saved value came from: our own find (web or a check), or the person's file.
function savedSource(account, field) {
  const hit = (account?.found?.filled || []).find((f) => f.field === field);
  if (!hit) return "Your file";
  return hit.how === "web" ? "Web" : "Found by us";
}

function when(iso) {
  return iso ? shortDate(iso) : "";
}

// profile: the server's company profile (or null while it loads). account: the saved company row (or null for an unsaved one).
export function summaryRows({ profile, account } = {}) {
  const mine = profile?.mine || null;
  const checks = mine?.checks || {};
  const verification = account?.verification || {};
  const savedEmail = account?.email || mine?.email || "";
  const savedPhone = account?.phone || mine?.phone || "";
  const savedName = account?.contact_name || mine?.contact_name || "";
  const best = profile?.best_contact || null;
  const reg = account?.registry_contact || null;

  let who = null;
  if (savedName) who = { name: savedName, role: account?.contact_title || mine?.contact_title || "", source: savedSource(account, "contact_name") };
  else if (best?.name) who = { name: best.name, role: best.role || "", source: "Register" };
  else if (reg?.name) who = { name: reg.name, role: reg.role || "", source: "Register" };

  const emailChecked = GOOD.has(verification.email?.state) ? verification.checked_at : GOOD.has(checks.email) ? checks.checked_at : "";
  let email = null;
  if (savedEmail) email = { value: savedEmail, source: savedSource(account, "email"), checked: when(emailChecked) };
  else if (best?.email) email = { value: best.email, source: "Register", checked: "" };
  else if (profile?.contact?.email?.value) email = { value: profile.contact.email.value, source: profile.contact.email.source === "web" ? "Web" : "Register", checked: "" };

  const phoneOk = verification.phone?.verified === true || checks.phone_ok === true;
  const phoneChecked = phoneOk ? verification.checked_at || checks.checked_at : "";
  let phone = null;
  if (savedPhone) phone = { value: savedPhone, source: savedSource(account, "phone"), checked: when(phoneChecked) };
  else if (profile?.contact?.phone?.value) phone = { value: profile.contact.phone.value, source: profile.contact.phone.source === "web" ? "Web" : "Register", checked: "" };

  return {
    fit: account?.fit ?? profile?.fit ?? null,
    who: who ? { ...who, name: personName(who.name) || niceName(who.name) } : null,
    email,
    phone,
    next: account?.next_step || profile?.next_action || null,
  };
}

// Which tab or action the next-step button leads to. The Summary only points; the work happens where it already lives.
export function nextTarget(next) {
  switch (next?.key) {
    case "choose": return { tab: "research", note: "Open the choices" };
    case "email": return { tab: "activity", note: "Add to a journey" };
    case "call": return { tab: "activity", note: "Call" };
    case "find": return { tab: "research", note: "Find a contact" };
    default: return null;
  }
}
