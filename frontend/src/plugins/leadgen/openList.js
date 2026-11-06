// The list the Lists screen should open on when it next mounts (set by "Open the list" after an import).
export const pendingList = { id: "" };
export const takePendingList = () => { const id = pendingList.id; pendingList.id = ""; return id; };
