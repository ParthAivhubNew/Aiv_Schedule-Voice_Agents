import { useSyncExternalStore } from "react";
import { api } from "../api/apiClient";

// The person's background runs (plans the assistants made and they pressed Run on). One copy for the whole app: the corner widget and the plan
// cards in the chats read it, so they never disagree. It polls only while there is something to watch.

export const ACTIVE = ["running", "waiting", "paused", "interrupted"];
const FAST_MS = 1500; // a step is running
const SLOW_MS = 12000; // waiting for the person, paused or interrupted

const store = { runs: [], loaded: false, subs: new Set(), timer: null, watchers: 0, inflight: false };

const emit = () => store.subs.forEach((f) => f());
const snapshot = () => store.runs; // a new array on every change, so React sees it

function schedule() {
  clearTimeout(store.timer);
  store.timer = null;
  if (!store.watchers) return;
  const running = store.runs.some((r) => r.status === "running");
  const active = store.runs.some((r) => ACTIVE.includes(r.status));
  if (!active) return;
  store.timer = setTimeout(() => { refreshRuns(); }, running ? FAST_MS : SLOW_MS);
}

export async function refreshRuns() {
  if (store.inflight) return;
  store.inflight = true;
  try {
    const r = await api.agentRuns();
    store.runs = r?.runs || [];
    store.loaded = true;
    emit();
  } catch (_) {
    // a failed check is tried again on the next tick; the widget keeps what it had
  } finally {
    store.inflight = false;
    schedule();
  }
}

function merge(run) {
  if (!run) return;
  const i = store.runs.findIndex((r) => r.id === run.id);
  store.runs = i === -1 ? [run, ...store.runs] : store.runs.map((r) => (r.id === run.id ? run : r));
  store.runs = [...store.runs].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  emit();
  schedule();
}

const act = (fn) => async (id, ...args) => {
  const res = await fn(id, ...args);
  merge(res?.run);
  return res?.run;
};
export const startRun = act((id) => api.agentStart(id));
export const pauseRun = act((id) => api.agentPause(id));
export const resumeRun = act((id) => api.agentResume(id));
export const cancelRun = act((id) => api.agentCancel(id));
export const answerGate = act((id, action) => api.agentGate(id, action));

// Called by the widget while it is on screen: loads the runs once and keeps them fresh while any is active.
export function watchRuns() {
  store.watchers += 1;
  if (!store.loaded) refreshRuns();
  else schedule();
  return () => {
    store.watchers -= 1;
    if (!store.watchers) { clearTimeout(store.timer); store.timer = null; }
  };
}

export function useAgentRuns() {
  return useSyncExternalStore((f) => { store.subs.add(f); return () => store.subs.delete(f); }, snapshot);
}

export const runById = (runs, id) => runs.find((r) => r.id === id);
export const isActive = (r) => ACTIVE.includes(r.status);
export const doneCount = (r) => (r.steps || []).filter((s) => s.state === "done" || s.state === "skipped").length;
export const PLUGIN_LABEL = { leads: "Leads", voice: "Voice", social: "Social" };
export const PLUGIN_COLOR = { leads: "#8B5CF6", voice: "#3457D5", social: "#0C8C7D" };
export const STATUS_LABEL = {
  planned: "Ready to run", running: "Working", waiting: "Needs you", paused: "Paused", interrupted: "Interrupted: the server restarted",
  done: "Done", cancelled: "Cancelled", failed: "Stopped: a step failed",
};

// Takes the person to the screen a waiting step needs. Social's pages live inside one screen, so it is told by event.
export function openGate(step, navigate) {
  const hash = step?.go || "";
  if (!hash) return;
  if (hash.startsWith("#/scheduler/")) {
    window.dispatchEvent(new CustomEvent("aivhub:social-goto", { detail: { page: hash.split("/")[2] || "plan", prompt: step.args?.request || "" } }));
    return;
  }
  navigate(hash);
}
