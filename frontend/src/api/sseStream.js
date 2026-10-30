import { announceAuthLost, getAccessToken, refreshSession } from "./authStore";

// Reads a server-sent-events body: calls onEvent(object) for each "data:" message, however the network cut the text into pieces.
export function createSseParser(onEvent) {
  let buffer = "";
  return (chunk) => {
    buffer += chunk;
    let at;
    while ((at = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, at);
      buffer = buffer.slice(at + 2);
      const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
      if (!data) continue;
      try {
        onEvent(JSON.parse(data));
      } catch (_) {
        // a message that is not JSON is skipped
      }
    }
  };
}

// POSTs to /api{path} and streams the events. Resolves when the stream ends; rejects with the server's message when it refuses to start.
export async function postEventStream(path, body, onEvent, { signal } = {}) {
  const send = () => {
    const token = getAccessToken();
    return fetch(`/api${path}`, {
      method: "POST", signal, body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  };
  let res = await send();
  if (res.status === 401) {
    if (await refreshSession()) res = await send();
    if (res.status === 401) {
      announceAuthLost();
      throw new Error("Your session ended. Please sign in again.");
    }
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const e = new Error(typeof err.detail === "string" ? err.detail : `Request failed with status ${res.status}`);
    e.status = res.status;
    throw e;
  }
  if (!res.body) throw new Error("This browser cannot read a live answer.");
  const feed = createSseParser(onEvent);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    feed(decoder.decode(value, { stream: true }));
  }
  feed("\n\n");
}
