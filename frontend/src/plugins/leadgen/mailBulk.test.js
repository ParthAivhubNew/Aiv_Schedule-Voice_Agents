import { describe, expect, it } from "vitest";
import { selectionLine } from "../../components/bulkSelect";
import { bulkDoneText, conversations, MAIL_SELECT_CAP } from "./mailBulk";

const unit = ["conversation", "conversations"];

describe("mail bulk actions", () => {
  it("says what was done and to how many", () => {
    expect(bulkDoneText("archive", 3)).toBe("Archived: 3 conversations.");
    expect(bulkDoneText("read", 1)).toBe("Marked as read: 1 conversation.");
    expect(bulkDoneText("star", 0)).toBe("Starred.");
    expect(conversations(1200)).toBe(`${(1200).toLocaleString()} conversations`);
  });

  it("offers every matching conversation once the shown ones are ticked", () => {
    const pageIds = Array.from({ length: 40 }, (_, i) => `m${i}`);
    const line = selectionLine({ count: 40, everything: false, ids: new Set(pageIds), pageIds, total: 120, reach: 120, unit });
    expect(line.offer).toBe("Select all 120");
  });

  it("says when select all stops at the cap", () => {
    const ids = new Set(Array.from({ length: MAIL_SELECT_CAP }, (_, i) => `m${i}`));
    const line = selectionLine({ count: MAIL_SELECT_CAP, everything: true, ids, pageIds: [], total: 900, reach: MAIL_SELECT_CAP, unit });
    expect(line.text).toContain(`The first ${MAIL_SELECT_CAP} of 900 conversations are selected`);
  });
});
