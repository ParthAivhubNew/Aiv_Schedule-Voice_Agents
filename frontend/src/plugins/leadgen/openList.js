// The list the Lists screen should open on when it next mounts (set by "Open the list" after an import).
export const pendingList = { id: "" };
export const takePendingList = () => { const id = pendingList.id; pendingList.id = ""; return id; };

// The list the person has open right now ("" on the overview), kept so that Back from a company page returns to inside that list.
export const lastList = { id: "" };
export const returnToList = () => { pendingList.id = lastList.id; };
