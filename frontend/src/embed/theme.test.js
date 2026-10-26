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
