import { describe, expect, it } from "vitest";
import { ENDPOINTS, endpointKey, defaultBody } from "./developerCatalog";
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
});
