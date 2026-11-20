// All backend calls for the Support panel live here. Each function returns
// a result or throws an error. Right now there is no backend, so every
// function reports that clearly. When the backend is ready, only this file
// needs to change.

const NOT_CONNECTED = "Support tickets are not switched on yet. Nothing was sent.";

export class SupportNotConnectedError extends Error {
  constructor() {
    super(NOT_CONNECTED);
    this.name = "SupportNotConnectedError";
    this.notConnected = true;
  }
}

/** Submit a new ticket. Returns { ok, message } or throws. */
export async function createTicket(/* data, files */) {
  throw new SupportNotConnectedError();
}

/** List the signed-in person's tickets. Returns [] or throws. */
export async function listTickets() {
  throw new SupportNotConnectedError();
}

/** Get a single ticket by id. Returns the ticket or throws. */
export async function getTicket(/* id */) {
  throw new SupportNotConnectedError();
}

/** Add a reply to a ticket thread. Returns { ok } or throws. */
export async function replyToTicket(/* id, text */) {
  throw new SupportNotConnectedError();
}

/** Close a ticket. Returns { ok } or throws. */
export async function closeTicket(/* id */) {
  throw new SupportNotConnectedError();
}
