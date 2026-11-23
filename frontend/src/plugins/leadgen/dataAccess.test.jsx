import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../api/apiClient", () => ({ api: new Proxy({}, { get: () => () => new Promise(() => {}) }) }));
vi.mock("../../brand/brandApi", () => ({ getOrgPolicy: () => new Promise(() => {}) }));

import { AdminCrown } from "../../components/AdminCrown";
import { AccessNotice } from "./AccessNotice";
import { DataAccessBody, UserCard, cleanArea, previewLine, NO_LIMIT_LINE, AREAS_HELP, EMPTY_LINE, HEADING_LINE } from "./DataAccess";
import { accessFlags, noticeLines, isOutsideAccess, limitedLine, CONTACT_LINE, EXPORT_OFF_LINE } from "./accessLogic";
import { GoogleViewBody, GOOGLE_OFF_LINE } from "./GoogleView";

const src = (f) => readFileSync(new URL(`./${f}`, import.meta.url), "utf8");
const html = (el) => renderToStaticMarkup(el);
const noop = () => {};
const esc = (s) => s.replace(/'/g, "&#x27;");

const roles = [{ id: "r1", name: "FSB Operator", is_admin: false }, { id: "r2", name: "FSB Admin", is_admin: true }];
const person = { id: "u1", name: "Sam Lee", username: "fsbuser", email: "fsbuser@outreach.com", is_admin: false, active: true, roles: [{ id: "r1", name: "FSB Operator" }], districts: ["BN1"], allow_export: true, allow_google: false };
const boss = { id: "u0", name: "Ada Boss", username: "fsbadmin", is_admin: true, active: true, roles: [{ id: "r2", name: "FSB Admin" }], districts: [] };

describe("AdminCrown", () => {
  it("is labelled and only shows for admins", () => {
    const h = html(<AdminCrown operator={{ is_admin: true }} />);
    expect(h).toContain('title="Administrator"');
    expect(h).toContain(">Admin<");
    expect(html(<AdminCrown operator={{ is_admin: false }} />)).toBe("");
    expect(html(<AdminCrown operator={null} />)).toBe("");
  });
});

describe("DataAccess", () => {
  it("shows the heading line and a loading state", () => {
    const h = html(<DataAccessBody data={null} error="" loading onSaved={noop} />);
    expect(h).toContain("Data access");
    expect(h).toContain(esc(HEADING_LINE));
    expect(h).toContain("Loading data access");
  });
  it("says so when there is nobody else", () => {
    const h = html(<DataAccessBody data={{ districts_allowed: [], roles, users: [boss] }} error="" onSaved={noop} />);
    expect(h).toContain(esc(EMPTY_LINE));
    expect(h).toContain("Admins");
    expect(h).toContain("Ada Boss");
    expect(h).toContain("Administrator");
    expect(h).not.toContain(">Save<");
  });
  it("shows a card with chips, role help, switches and a disabled Save", () => {
    const h = html(<DataAccessBody data={{ districts_allowed: ["BN1", "BN3"], roles, users: [boss, person] }} error="" onSaved={noop} />);
    expect(h).toContain("Sam Lee");
    expect(h).toContain("fsbuser@outreach.com");
    expect(h).toContain("FSB Operator");
    expect(h).not.toContain(">FSB Admin<");
    expect(h).toContain("Controls which apps they can use");
    expect(h).toContain('aria-label="Remove BN1"'); // a chosen area is a chip that can be removed
    expect(h).toContain("Add a district, e.g. LS1, M1 or EC2A"); // any UK district or area can be typed in
    expect(h).toContain("Clear all");
    expect(h).toContain("Can export data");
    expect(h).toContain("Can open live Google details");
    expect(h).toContain("On until you switch it off");
    expect(h).toContain("What will they see?");
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Save/);
  });
  it("says there is no personal limit when no area is chosen", () => {
    const h = html(<UserCard user={{ ...person, districts: [] }} roles={roles} allowed={["BN1"]} onSaved={noop} />);
    expect(h).toContain(NO_LIMIT_LINE);
    expect(h).toContain("All postcodes");
    expect(h).toContain("Only these postcodes");
    expect(h).not.toContain("Add a district, e.g. LS1"); // the box to add districts appears only after "Only these postcodes"
    const limited = html(<UserCard user={person} roles={roles} allowed={["BN1"]} onSaved={noop} />);
    expect(limited).not.toContain(NO_LIMIT_LINE);
    expect(limited).toContain(esc(AREAS_HELP));
    expect(limited).toContain('aria-checked="true"');
  });
  it("words the preview and shows it and server errors", () => {
    expect(previewLine({ companies: 1240, districts: ["BN1", "BN3", "BN5"] })).toBe("1,240 companies in 3 areas");
    expect(previewLine({ companies: 5, districts: [] })).toBe("5 companies in all postcodes");
    expect(cleanArea(" ls 1 ")).toBe("LS1");
    expect(cleanArea("m")).toBe("M");
    expect(cleanArea("EC2A")).toBe("EC2A");
    expect(cleanArea("nonsense")).toBe("");
    expect(previewLine({ companies: 1, districts: ["BN1"] })).toBe("1 company in 1 area");
    const h = html(<UserCard user={person} roles={roles} allowed={["BN1"]} onSaved={noop} initialPreview={{ companies: 12, districts: ["BN1"] }} initialError="That area is outside the areas this organisation can use." />);
    expect(h).toContain("12 companies in 1 area");
    expect(h).toContain('role="alert"');
    expect(h).toContain("outside the areas this organisation can use");
    expect(h).toContain('aria-live="polite"');
  });
  it("shows a load error", () => {
    const h = html(<DataAccessBody data={null} error="Admins only." onSaved={noop} />);
    expect(h).toContain('role="alert"');
    expect(h).toContain("Admins only.");
  });
});

describe("navigation wiring", () => {
  const plugin = src("LeadGenerationPlugin.jsx");
  it("lists Data access in Setup for admins only and never renders it otherwise", () => {
    expect(plugin).toMatch(/showDataAccess = isAdminOperator\(operator\)/);
    expect(plugin).toMatch(/showDataAccess \? \[\{ id: "administration", label: "Administration", icon: Shield, group: "Setup"/);
    expect(plugin).not.toContain('id: "data_access", label:');
    expect(plugin).toMatch(/view === "data_access" && showDataAccess && <DataAccess/);
    expect(plugin).toContain('(view === "data_access" || view === "administration") && !showDataAccess');
  });
});

describe("AccessNotice", () => {
  it("is an empty status region without a message", () => {
    const h = html(<AccessNotice message="" />);
    expect(h).toContain('role="status"');
    expect(h).not.toContain("<svg");
  });
  it("shows the server text with an icon and adds the contact line only when missing", () => {
    const h = html(<AccessNotice message="That company is outside your areas." />);
    expect(h).toContain("<svg");
    expect(h).toContain("outside your areas");
    expect(h).toContain(CONTACT_LINE);
    expect(noticeLines("Not in your areas. Ask your administrator.")).toEqual(["Not in your areas. Ask your administrator."]);
  });
  it("recognises the outside_access refusal", () => {
    expect(isOutsideAccess({ status: 403, code: "outside_access" })).toBe(true);
    expect(isOutsideAccess({ status: 403, code: "export_off" })).toBe(false);
    expect(isOutsideAccess(null)).toBe(false);
  });
});

describe("data_access flags", () => {
  it("reads limits and switches, and ignores them for admins and when absent", () => {
    const op = { is_admin: false, data_access: { limited: true, districts: ["BN1", "BN3"], allow_export: false, allow_google: false } };
    expect(accessFlags(op)).toEqual({ limited: true, districts: ["BN1", "BN3"], exportOff: true, googleOff: true });
    expect(accessFlags({ ...op, is_admin: true }).exportOff).toBe(false);
    expect(accessFlags({}).limited).toBe(false);
    expect(accessFlags(null, { data_access: { allow_google: false } }).googleOff).toBe(true);
  });
  it("words the limited line and the hints", () => {
    expect(limitedLine(["BN1", "BN3"])).toBe("Your account is limited to: BN1, BN3. Ask your administrator to change this.");
    expect(EXPORT_OFF_LINE).toBe("Export is switched off for your account. Ask your administrator.");
  });
  it("hides Google details and says why when switched off", () => {
    const off = html(<GoogleViewBody policy={{ restrictedSources: [], data_access: { allow_google: false } }} phase="idle" onShow={noop} onClose={noop} />);
    expect(off).toContain(esc(GOOGLE_OFF_LINE));
    expect(off).not.toContain("Show Google details");
    const on = html(<GoogleViewBody policy={{ restrictedSources: [], data_access: { allow_google: true } }} phase="idle" onShow={noop} onClose={noop} />);
    expect(on).toContain("Show Google details");
  });
  it("wires the export hint and the limited note", () => {
    expect(src("LeadGenerationPlugin.jsx")).toContain("access.exportOff");
    expect(src("FindLeadsView.jsx")).toContain("limitedLine(access.districts)");
  });
});
