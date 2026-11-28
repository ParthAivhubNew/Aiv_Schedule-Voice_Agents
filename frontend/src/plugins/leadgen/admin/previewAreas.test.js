import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("What will they see? on Add user", () => {
  it("counts the typed areas when there is no saved person, instead of calling a per-person route with an empty id", () => {
    const s = readFileSync(new URL("./AccessEditor.jsx", import.meta.url), "utf8");
    expect(s).toContain("userId ? await api.previewDataAccess(userId) : await api.previewAreas(only ? districts : [])");
    const api = readFileSync(new URL("../../../api/apiClient.js", import.meta.url), "utf8");
    expect(api).toContain("previewAreas: (districts) => apiRequest('/org/data-access/preview', { method: 'POST'");
  });
});
