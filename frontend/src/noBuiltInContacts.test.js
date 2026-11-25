import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// A new account must not start with someone's real phone number built in (plan 11 step 7). Sample data uses Ofcom's drama range
// (07700 900000-900999), which is never a real line.
const FILES = ["plugins/voice/DirectOutboundCallCard.jsx", "plugins/voice/ConversationTemplatesView.jsx", "tokens.js"];

describe("no real phone numbers or people built into the screens", () => {
  for (const file of FILES) {
    it(file, () => {
      const src = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      const numbers = (src.match(/\+44\s?7\d{3}\s?\d{6}/g) || []).filter((n) => !/^\+44\s?7700\s?900/.test(n));
      expect(numbers).toEqual([]);
      expect(src).not.toMatch(/jitendra/i);
    });
  }
});
