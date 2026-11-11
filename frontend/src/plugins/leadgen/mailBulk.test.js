import { describe, expect, it } from "vitest";
import { selectionLine } from "../../components/bulkSelect";
import { bulkDoneText, conversations, deliverability, MAIL_SELECT_CAP, MORE_FOLDERS, replyNextStep } from "./mailBulk";

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

describe("reply chips in Mail", () => {
  it("maps each reply category to one next step", () => {
    expect(replyNextStep("interested")).toEqual({ key: "times", label: "Send times" });
    expect(replyNextStep("question").label).toBe("Reply");
    expect(replyNextStep("not_interested").key).toBe("lost");
    expect(replyNextStep("ooo").label).toBe("Wait 3 days");
    expect(replyNextStep("unsubscribe").passive).toBe(true);
    expect(replyNextStep("")).toBeNull();
  });

  it("keeps drafts, spam and trash under More folders", () => {
    expect(MORE_FOLDERS).toEqual(["drafts", "spam", "trash"]);
  });

  it("reads a mailbox's seven days in plain words", () => {
    const d = deliverability({ sent_7d: 200, bounced_7d: 4, complaints_7d: 1, spf_verified: true, dkim_verified: false, dmarc_verified: false, bounce_health: { state: "warning" } });
    expect(d).toMatchObject({ bounce: "2.0%", complaints: 1, spf: "Set up", dkim: "Not set up", dmarc: "Not found", warn: true });
    expect(deliverability({}).bounce).toBe("No sends yet");
  });
});
