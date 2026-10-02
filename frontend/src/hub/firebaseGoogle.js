// Google sign-in through Firebase Authentication. The Firebase code is loaded only when someone
// presses the Google button, so the sign-in page stays small. We only borrow Firebase to prove
// who the person is: the ID token goes to our server, which signs them in to OutReach.

const MESSAGES = {
  "auth/popup-closed-by-user": "Google sign-in was cancelled.",
  "auth/cancelled-popup-request": "Google sign-in was cancelled.",
  "auth/popup-blocked": "Your browser blocked the Google window. Allow pop-ups for this site and try again.",
  "auth/unauthorized-domain": "Google sign-in is not allowed on this address yet. Ask the OutReach team to add it in Firebase.",
  "auth/network-request-failed": "Could not reach Google. Check your connection and try again.",
};

export function googleErrorText(err) {
  return MESSAGES[err?.code] || err?.message || "Google sign-in did not work. Try again.";
}

export async function googleIdToken(config) {
  const [{ getApps, initializeApp }, { GoogleAuthProvider, getAuth, signInWithPopup, signOut }] = await Promise.all([
    import("firebase/app"),
    import("firebase/auth"),
  ]);
  const app = getApps().find((a) => a.name === "outreach") || initializeApp(config, "outreach");
  const auth = getAuth(app);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const result = await signInWithPopup(auth, provider);
  const token = await result.user.getIdToken();
  signOut(auth).catch(() => {}); // our own session takes over from here
  return token;
}
