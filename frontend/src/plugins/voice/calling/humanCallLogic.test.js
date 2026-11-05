import { describe, expect, it } from "vitest";
import { clock, cleanNumber, costLine, minutesLeft, rateLine, speakerWord, stageOf, transcriptWords, validNumber } from "./humanCallLogic";

describe("numbers", () => {
  it("turns what people type into a number the server accepts", () => {
    expect(cleanNumber("01189 000 123")).toBe("+441189000123");
    expect(cleanNumber("0044 118 900 0123")).toBe("+441189000123");
    expect(cleanNumber("+44 (0)118 900 0123")).toBe("+441189000123");
    expect(cleanNumber("+1 415-555-0100")).toBe("+14155550100");
    expect(cleanNumber("")).toBe("");
  });
  it("accepts only whole numbers", () => {
    expect(validNumber("07700 900123")).toBe(true);
    expect(validNumber("12")).toBe(false);
    expect(validNumber("hello")).toBe(false);
  });
});

describe("stages", () => {
  it("names the phone library's states in three words", () => {
    expect(["new", "trying", "requesting", "ringing"].map(stageOf)).toEqual(["ringing", "ringing", "ringing", "ringing"]);
    expect(stageOf("active")).toBe("connected");
    expect(["hangup", "destroy"].map(stageOf)).toEqual(["ended", "ended"]);
    expect(stageOf("held")).toBe("");
  });
});

describe("clock and credit", () => {
  it("shows minutes and seconds", () => {
    expect(clock(161)).toBe("02:41");
    expect(clock(-5)).toBe("00:00");
  });
  it("counts the minutes left in the hold", () => {
    expect(minutesLeft(3600, 125)).toBe(58);
    expect(minutesLeft(null, 10)).toBe(null);
    expect(minutesLeft(60, 500)).toBe(0);
  });
  it("says what a minute costs, with and without a transcript", () => {
    const rates = { call: 1, transcript: 1 };
    expect(rateLine(rates, false)).toBe("1 credit a minute");
    expect(rateLine(rates, true)).toBe("2 credits a minute with transcript");
    expect(costLine(3, rates, true)).toBe("3 min call + 3 min transcript = 6 credits");
    expect(costLine(3, rates, false)).toBe("3 min · 3 credits");
    expect(costLine(0, rates, true)).toBe("Not charged");
  });
});

describe("transcript words", () => {
  it("says where the transcript is", () => {
    expect(transcriptWords("working")).toBe("Transcript is being made");
    expect(transcriptWords("ready")).toBe("Transcript ready");
    expect(transcriptWords("failed", "Try again")).toBe("Try again");
    expect(transcriptWords("none")).toBe("");
    expect(speakerWord("you")).toBe("You");
    expect(speakerWord("them")).toBe("Them");
  });
});
