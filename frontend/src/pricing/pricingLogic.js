import { creditWord, priceWord } from "../app/usePrice";

// The public pricing page's wording (GET /auth/pricing). Every price comes from the server: plans and top-ups as staff set them in the
// staff portal, and the standard rate card. Nothing here is a price.

// "£49.99", "$19" (whole amounts without pence).
export function money(cents, currency = "GBP") {
  const amount = (Number(cents) || 0) / 100;
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: String(currency || "GBP").toUpperCase(),
      minimumFractionDigits: amount % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(amount);
  } catch (_) {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

// What a plan's credits buy, in the app's own terms: Voice credits are call minutes.
export function creditsLine(appId, credits, { monthly = true } = {}) {
  const n = Number(credits) || 0;
  const per = monthly ? " a month" : "";
  if (appId === "voice") {
    const hours = n / 60;
    const time = n % 60 === 0 && n >= 60 ? `${hours} hour${hours === 1 ? "" : "s"}` : `${n} minute${n === 1 ? "" : "s"}`;
    return `${n.toLocaleString("en-GB")} credits${per}: ${time} of calls`;
  }
  return `${n.toLocaleString("en-GB")} credits${per}`;
}

// "1 credit per minute", "2.5 credits per e-mail found", "Free".
export function actionPrice(action) {
  const word = priceWord({ credits: action.credits, unit: action.unit });
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : creditWord(action.credits);
}

// The apps in the order the page shows them, with plans cheapest first.
export function appsInOrder(apps) {
  const order = { leadgen: 0, voice: 1, scheduler: 2 };
  return [...(apps || [])]
    .sort((a, b) => (order[a.id] ?? 9) - (order[b.id] ?? 9))
    .map((a) => ({ ...a, plans: [...(a.plans || [])].sort((x, y) => x.priceCents - y.priceCents) }));
}
