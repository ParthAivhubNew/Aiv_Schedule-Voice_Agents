import { useEffect, useState } from "react";
import { api } from "../api/apiClient";

// What an action costs, from the company's own rate card (GET /credits/wallet/<app>), so every paid button can say its price before it
// is pressed (plan 11, C.6). One request per app's wallet, shared by every button that asks. Prices are never written into the screens.

const rates = {}; // wallet -> { item: { label, unit, credits } }
const pending = {};

export function useRates(wallet = "leadgen") {
  const [, bump] = useState(0);
  useEffect(() => {
    if (rates[wallet]) return undefined;
    let alive = true;
    if (!pending[wallet]) {
      pending[wallet] = Promise.resolve()
        .then(() => (wallet === "leadgen" ? api.getLeadCredits() : api.getWalletGlance(wallet)))
        .then((c) => { rates[wallet] = c?.rates || {}; })
        .catch(() => { delete pending[wallet]; });
    }
    pending[wallet].then(() => alive && bump((n) => n + 1));
    return () => {
      alive = false;
    };
  }, [wallet]);
  return rates[wallet] || null;
}

// One item's rate ({ credits, unit, label }), or null until it is known.
export function useRate(item, wallet = "leadgen") {
  const all = useRates(wallet);
  return all ? all[item] || null : null;
}

// "1 credit", "2.5 credits", "Free".
export const creditWord = (n) => (!n ? "Free" : `${n} credit${n === 1 ? "" : "s"}`);

// "1 credit per 5 lines", "2 credits per image", "Free"; "" while the price is not known.
export function priceWord(rate) {
  if (!rate) return "";
  const word = creditWord(rate.credits).toLowerCase();
  return rate.credits && rate.unit ? `${word} per ${rate.unit}` : word;
}

// For tests: forget what was fetched.
export function resetPrices() {
  Object.keys(rates).forEach((k) => delete rates[k]);
  Object.keys(pending).forEach((k) => delete pending[k]);
}
