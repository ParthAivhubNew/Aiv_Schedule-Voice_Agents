// Pure helpers for the retention review screen.

export function toggleAll(ids, selected) {
  return selected.size === ids.length ? new Set() : new Set(ids);
}

export function toggleOne(selected, id) {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function deleteSummary(n) {
  return n ? `Delete ${plural(n, "company", "companies")}` : "Delete";
}

export function deleteResult({ deleted = 0, locked = 0 } = {}) {
  const done = deleted ? `Deleted ${plural(deleted, "company", "companies")}.` : "Nothing was deleted.";
  return locked ? `${done} ${plural(locked, "is", "are")} being checked right now and stays until the next time.` : done;
}
