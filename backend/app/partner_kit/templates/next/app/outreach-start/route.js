// Gives your page a short-lived pass for an Outreach screen. Runs on your server only.
// The secret key comes from .env.local (see START-HERE.txt) and never reaches the browser.
const OUTREACH = "{{HOST}}/api/embed";

async function call(path, body) {
  const res = await fetch(OUTREACH + path, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OUTREACH_SECRET}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Outreach answered ${res.status}`);
  return data;
}

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    // TESTING ONLY: one fixed test person. Before real users: the id of whoever is signed in, and a 401 when nobody is.
    const external_id = process.env.TEST_USER_ID || "test-user-1";
    const component = new URL(request.url).searchParams.get("component") || "leads";
    const info = await call("/connect-sessions", { external_id, component });
    if (!info.linked) return Response.json({ connect_token: info.connect_token });
    const pass = await call("/sessions", { external_id, component });
    return Response.json({ token: pass.token });
  } catch (err) {
    console.error("Outreach said:", err.message);
    return Response.json({ error: err.message }, { status: 502 });
  }
}
