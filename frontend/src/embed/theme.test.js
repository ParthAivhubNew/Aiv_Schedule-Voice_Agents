import { describe, expect, it } from "vitest";
import { cleanAppearance, mix, themeCss, themeVars } from "./theme";

describe("cleanAppearance", () => {
  it("keeps valid colours, font and radius", () => {
    const out = cleanAppearance({ variables: { colorPrimary: "#0F766E", colorText: "#123", fontFamily: "serif", borderRadius: 12 } });
    expect(out.variables).toEqual({ colorPrimary: "#0f766e", colorText: "#123", fontFamily: "serif", borderRadius: 12 });
  });

  it("drops anything that is not a plain value from the lists", () => {
    const out = cleanAppearance({
      variables: {
        colorPrimary: "red", colorBackground: "#12345", colorSurface: "url(javascript:alert(1))", colorText: "#fff; } body { display:none",
        colorDanger: 5, fontFamily: "Comic Sans; } *{", borderRadius: 99, evil: "x",
      },
    });
    expect(out.variables).toEqual({});
  });

  it("copes with junk", () => {
    expect(cleanAppearance(null).variables).toEqual({});
    expect(cleanAppearance("x").variables).toEqual({});
    expect(cleanAppearance({ variables: [] }).variables).toEqual({});
    expect(cleanAppearance({ variables: { borderRadius: "8" } }).variables).toEqual({});
    expect(cleanAppearance({ variables: { borderRadius: -1 } }).variables).toEqual({});
  });

  it("accepts radius 0 and the largest allowed", () => {
    expect(cleanAppearance({ variables: { borderRadius: 0 } }).variables.borderRadius).toBe(0);
    expect(cleanAppearance({ variables: { borderRadius: 24 } }).variables.borderRadius).toBe(24);
  });
});

describe("themeCss", () => {
  it("is empty without a look", () => {
    expect(themeCss(undefined)).toBe("");
    expect(themeCss({ variables: {} })).toBe("");
  });

  it("sets the app's variables and forces the accent over an app's own", () => {
    const css = themeCss({ variables: { colorPrimary: "#0f766e", borderRadius: 10, fontFamily: "serif" } });
    expect(css).toContain("--ui-accent: #0f766e");
    expect(css).toContain("--ui-r: 10px");
    expect(css).toContain('[style*="--ui-accent"]');
    expect(css).toContain("--ui-accent: #0f766e !important");
    expect(css).toContain("Georgia");
  });

  it("never lets a rejected value reach the page", () => {
    const css = themeCss({ variables: { colorPrimary: "#fff; } body { display:none", fontFamily: "x; } *{" } });
    expect(css).toBe("");
  });

  it("derives the lighter and darker shades from the primary colour", () => {
    const v = themeVars({ variables: { colorPrimary: "#336699" } });
    expect(v.accent["--ui-accent"]).toBe("#336699");
    expect(v.accent["--ui-accent-soft"]).toBe(mix("#336699", "#ffffff", 0.9));
    expect(v.accent["--ui-ring"]).toBe("rgba(51, 102, 153, 0.22)");
  });
});

describe("mix", () => {
  it("goes from one colour to another", () => {
    expect(mix("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mix("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mix("#000", "#fff", 0.5)).toBe("#808080");
  });
});

describe("name, logo and side menu", () => {
  it("keeps a plain name and an https logo, and nothing else", () => {
    const out = cleanAppearance({ variables: { brandName: "  Acme <b>CRM</b>  ", logoUrl: "https://acme.test/logo.svg" } });
    expect(out.variables.brandName).toBe("Acme bCRM/b");
    expect(out.variables.logoUrl).toBe("https://acme.test/logo.svg");
  });

  it("refuses any logo that is not a plain https address", () => {
    for (const bad of ["http://acme.test/l.png", "javascript:alert(1)", "data:image/svg+xml;base64,AAAA", "//acme.test/l.png", "/logo.png",
      "https://user:pw@acme.test/l.png", "https://acme.test/a b.png", "https://acme.test/<x>.png", "x".repeat(400)]) {
      expect(cleanAppearance({ variables: { logoUrl: bad } }).variables.logoUrl, bad).toBeUndefined();
    }
  });

  it("cuts a long name and drops one that is only markup", () => {
    expect(cleanAppearance({ variables: { brandName: "x".repeat(80) } }).variables.brandName).toHaveLength(40);
    expect(cleanAppearance({ variables: { brandName: "<>" } }).variables.brandName).toBeUndefined();
  });

  it("derives the whole side menu from its background, picking readable text", () => {
    const dark = themeVars({ variables: { colorSidebar: "#1e3a8a" } });
    expect(dark.root["--ui-side-bg"]).toBe("#1e3a8a");
    expect(dark.root["--ui-side-strong"]).toBe("#ffffff");
    const pale = themeVars({ variables: { colorSidebar: "#f3f4f6" } });
    expect(pale.root["--ui-side-strong"]).toBe("#1f2937");
    expect(pale.root["--ui-side-hover"]).toBe("rgba(31, 41, 55, 0.08)");
    const own = themeVars({ variables: { colorSidebar: "#1e3a8a", colorSidebarText: "#fde68a" } });
    expect(own.root["--ui-side-strong"]).toBe("#fde68a");
  });

  it("carries the brand out for the sidebar", () => {
    expect(themeVars({ variables: { brandName: "Acme", logoUrl: "https://acme.test/l.svg" } }).brand).toEqual({ name: "Acme", logoUrl: "https://acme.test/l.svg" });
    expect(themeVars({}).brand).toEqual({ name: "", logoUrl: "" });
  });
});
