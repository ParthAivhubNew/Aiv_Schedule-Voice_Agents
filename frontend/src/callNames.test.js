import { describe, expect, it } from "vitest";
import { logDisplayName, nameStatedByCaller } from "./tokens";

const said = (text) => [{ who: "them", text }];

describe("the name a caller gives on the call", () => {
  it.each([
    ["My name is Priya Shah", "Priya Shah"],
    ["This is Tom from the garage", "Tom"],
    ["Hi, it's Raj", "Raj"],
    ["I'm Dana, calling about the invoice", "Dana"],
    ["Call me Sam", "Sam"],
    ["Yes, you're speaking to Lee", "Lee"],
    ["Mehta speaking", "Mehta"],
    ["Mr Patel here", "Patel"],
    ["It's Sarah's number", "Sarah"],
    ["This is regarding my order", ""],
    ["I'm calling about a quote", ""],
    ["It's Tuesday, I know", ""],
  ])("%s", (line, want) => expect(nameStatedByCaller(said(line))).toBe(want));

  it("counts only the caller's own lines", () => {
    expect(nameStatedByCaller([{ who: "ai", text: "Hello, this is Sam from Acme. My name is Sam." }])).toBe("");
  });

  it("reads prefixed string transcripts", () => {
    expect(nameStatedByCaller(["AI: who am I speaking with?", "Prospect: It's Jitendra Rao.", "AI: Thanks Jitendra."])).toBe("Jitendra Rao");
  });
});

describe("who a call is listed as", () => {
  const base = { personListedAs: "", canonicalName: "", listedAs: "", transcript: [] };

  it("takes the name the caller said over a name the AI assumed", () => {
    const entry = { ...base, transcript: [{ who: "ai", text: "Hi Howard, it's Sam." }, { who: "them", text: "No, this is Mary." }] };
    expect(logDisplayName(entry)).toBe("Mary");
  });

  it("takes the name the caller said over a stored one", () => {
    expect(logDisplayName({ ...base, personListedAs: "Howard", transcript: said("My name is Ayesha Khan") })).toBe("Ayesha Khan");
  });

  it("falls back to the contact that owns the number, then the number itself", () => {
    expect(logDisplayName({ ...base, callerName: "Jo Bloggs", phone: "+441134960412" })).toBe("Jo Bloggs");
    expect(logDisplayName({ ...base, phone: "+441134960412" })).toBe("+441134960412");
  });
});
