import { describe, expect, it } from "vitest";
import { ENDPOINTS, RUN_ACTIONS, endpointKey, defaultBody, runRequest } from "./developerCatalog";
import { SNIPPET_LANGS, buildSnippet, snippetsFor } from "./developerSnippets";

describe("developer snippets", () => {
  it("sends the real method and body for each language", () => {
    const body = JSON.stringify({ decision: "approve" });
    const curl = buildSnippet("curl", "POST", "/v1/social/posts/v2_1/decision", "sk_test_x", body);
    expect(curl).toContain('curl -X POST "https://api.outreach.aivhub.com/v1/social/posts/v2_1/decision"');
    expect(curl).toContain("Authorization: Bearer sk_test_x");
    expect(curl).toContain("-d '{\"decision\":\"approve\"}'");
    expect(buildSnippet("node", "PATCH", "/v1/x", "k", "{}")).toContain('method: "PATCH"');
    expect(buildSnippet("python", "PATCH", "/v1/x", "k", "{}")).toContain('requests.request("PATCH"');
    expect(buildSnippet("php", "PATCH", "/v1/x", "k", "{}")).toContain('CURLOPT_CUSTOMREQUEST => "PATCH"');
    expect(buildSnippet("go", "PATCH", "/v1/x", "k", "{}")).toContain('http.NewRequest("PATCH"');
    expect(buildSnippet("java", "PATCH", "/v1/x", "k", "{}")).toContain('.method("PATCH"');
  });

  it("sends no body for GET and DELETE", () => {
    for (const method of ["GET", "DELETE"]) {
      for (const lang of SNIPPET_LANGS) {
        const code = buildSnippet(lang, method, "/v1/voice/calls/call_1", "k", '{"ignored":true}');
        expect(code).not.toContain("ignored");
        expect(code).toContain(method);
      }
    }
  });

  it("quotes single quotes safely in curl", () => {
    const body = JSON.stringify({ a: "it's" });
    expect(buildSnippet("curl", "POST", "/v1/x", "k", body)).toContain(String.raw`it'\''s`);
  });

  it("covers every language for every documented call", () => {
    for (const ep of ENDPOINTS) {
      const path = ep.pathParam ? ep.path.replace(`{${ep.pathParam.name}}`, ep.pathParam.example) : ep.path;
      const all = snippetsFor(ep.method, path, "sk_test_x", defaultBody(ep));
      expect(Object.keys(all)).toEqual(SNIPPET_LANGS);
      for (const code of Object.values(all)) expect(code).toContain("sk_test_x");
    }
  });

  it("lists each call once, with a real permission and a plain summary", () => {
    const keys = ENDPOINTS.map(endpointKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const ep of ENDPOINTS) {
      expect(ep.path.startsWith("/v1/")).toBe(true);
      expect(ep.summary.length).toBeGreaterThan(20);
      expect(ep.scope).toMatch(/^[a-z]+:[a-z]+$|^any key$/);
    }
  });
  it("gives every documented call one action on the one endpoint", () => {
    const actions = ENDPOINTS.map((ep) => RUN_ACTIONS[endpointKey({ method: ep.method, path: ep.path.split("?")[0] })]);
    expect(actions.every(Boolean)).toBe(true);
    expect(new Set(actions).size).toBe(ENDPOINTS.length);
    expect(Object.keys(RUN_ACTIONS)).toHaveLength(ENDPOINTS.length);
  });

  it("turns a call into a request to POST /v1/run", () => {
    const find = (m, p) => ENDPOINTS.find((e) => e.method === m && e.path === p);
    const start = runRequest(find("POST", "/v1/voice/calls"), defaultBody(find("POST", "/v1/voice/calls")));
    expect(start.method).toBe("POST");
    expect(start.path).toBe("/v1/run");
    expect(JSON.parse(start.body)).toMatchObject({ plugin: "voice", action: "call.start", data: { to: "+447911123456" } });
    const got = JSON.parse(runRequest(find("GET", "/v1/voice/calls/{id}"), "").body);
    expect(got).toEqual({ plugin: "voice", action: "call.get", id: "call_8f2a91c4" });
    const slots = JSON.parse(runRequest(ENDPOINTS.find((e) => e.path.startsWith("/v1/meetings/slots")), "").body);
    expect(slots).toEqual({ plugin: "voice", action: "meeting.slots", data: { date: "2026-11-03", days: "3" } });
  });
});
