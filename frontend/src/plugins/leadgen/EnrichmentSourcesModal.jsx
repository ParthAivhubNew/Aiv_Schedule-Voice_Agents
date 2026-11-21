import React, { useState } from "react";
import { Check, ExternalLink, Info, Search, ShieldCheck, Sparkles, X, Zap } from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../../tokens";
import {
  ClassifierAiLogo,
  CompaniesHouseLogo,
  CqcLogo,
  DirectorMatchLogo,
  FsaLogo,
  LeadFitLogo,
  OrdnanceSurveyLogo,
  TpsLogo,
  WebCrawlerLogo,
} from "./ConnectorLogos";

const text = { fontFamily: FONT_BODY };
const head = { fontFamily: FONT_DISPLAY };

export const ENRICHMENT_SOURCES = [
  {
    id: "ch_registry",
    name: "Companies House Live Registry API",
    category: "Official Statutory Register",
    authority: "UK Government Executive Agency",
    LogoComponent: CompaniesHouseLogo,
    endpoint: "https://api.company-information.service.gov.uk",
    latency: "32ms",
    cadence: "Real-time instant lookups",
    fieldsEnriched: [
      "Company Registration Number",
      "Official Registered Office Address & Postcode",
      "Live Active / Liquidation / Dissolution Status",
      "5-Digit UK SIC 2007 Classification Codes",
      "Incorporation Date & Statutory Accounts Due Dates",
    ],
    desc: "Enriches uploaded contacts with legal verification against 5.2M+ registered UK legal entities, ensuring only legitimate, active trading entities are contacted.",
  },
  {
    id: "directors_registry",
    name: "Statutory Officers & Directors API",
    category: "Officer Intelligence",
    authority: "Companies House Registrar of Companies",
    LogoComponent: DirectorMatchLogo,
    endpoint: "https://api.company-information.service.gov.uk/company/{id}/officers",
    latency: "45ms",
    cadence: "Real-time query resolution",
    fieldsEnriched: [
      "Managing Directors, CEOs & Owners",
      "Persons with Significant Control (PSCs)",
      "Officer Appointment Dates & Resignation History",
      "Executive Seniority & Decision-Maker Classification",
    ],
    desc: "Matches your contact records against filed statutory officers to discover the primary commercial decision-maker and verify tenure at the business.",
  },
  {
    id: "tps_ctps",
    name: "TPS & Corporate TPS Compliance API",
    category: "Statutory Compliance",
    authority: "Telephone Preference Service / Ofcom",
    LogoComponent: TpsLogo,
    endpoint: "https://compliance.tpsonline.org.uk/api/v1/check",
    latency: "24ms",
    cadence: "Pre-dial real-time screening",
    fieldsEnriched: [
      "TPS Consumer Do-Not-Call Status",
      "CTPS Corporate Do-Not-Call Status",
      "Statutory Cold-Calling Eligibility Pass/Fail",
      "Screening Timestamp & Audit Hash",
    ],
    desc: "Statutory live telephone screening preventing cold-calling regulatory breaches. Phone numbers listed on TPS/CTPS are flagged and suppressed automatically.",
  },
  {
    id: "os_postcodes",
    name: "Ordnance Survey PAF & Geo API",
    category: "Geographic Coordinates",
    authority: "Ordnance Survey Data Hub",
    LogoComponent: OrdnanceSurveyLogo,
    endpoint: "https://api.os.uk/search/places/v1/postcode",
    latency: "18ms",
    cadence: "Instant address verification",
    fieldsEnriched: [
      "Postcode Address File (PAF) Clean Address",
      "Easting & Northing Geographic Coordinates",
      "Administrative Ward & District Council",
      "Radius Proximity & Territory Mapping",
    ],
    desc: "Cleans irregular address strings from spreadsheets, confirms official PAF postcodes, and injects exact geographical coordinates for radius filtering.",
  },
  {
    id: "fsa_hygiene",
    name: "Food Standards Agency (FSA) Hygiene API",
    category: "Hospitality & Food Inspection",
    authority: "UK Food Standards Agency",
    LogoComponent: FsaLogo,
    endpoint: "https://api.ratings.food.gov.uk/Establishments",
    latency: "44ms",
    cadence: "Daily syndicated update",
    fieldsEnriched: [
      "Official Food Hygiene Rating (0 to 5)",
      "Local Authority Inspection Authority",
      "Trading Premise Name vs Legal Registered Entity",
      "Inspection Date & Compliance Rating Key",
    ],
    desc: "Enriches food, catering, hospitality, and retail premises with official hygiene scores and inspected trading names.",
  },
  {
    id: "cqc_care",
    name: "Care Quality Commission (CQC) API",
    category: "Healthcare & Care Registers",
    authority: "Care Quality Commission",
    LogoComponent: CqcLogo,
    endpoint: "https://api.cqc.org.uk/public/v1/providers",
    latency: "51ms",
    cadence: "Weekly syndicated synchronization",
    fieldsEnriched: [
      "CQC Provider Registration ID",
      "Inspection Directorate (Adult Social Care, Dental, GP)",
      "Overall Quality & Safety Rating",
      "Registered Nominated Individual / Practice Manager",
    ],
    desc: "Identifies accredited care providers, NHS clinics, private surgeries, and care homes, enriching contacts with official regulatory ratings.",
  },
  {
    id: "web_dossier",
    name: "Web Crawler & Domain MX Engine",
    category: "Digital Presence & Email Verification",
    authority: "Outreach In-Memory Extraction Cluster",
    LogoComponent: WebCrawlerLogo,
    endpoint: "https://engine.outreach.internal/crawler/v2",
    latency: "115ms",
    cadence: "On-demand company verification",
    fieldsEnriched: [
      "Domain MX Record Routing & Verification",
      "SSL Certificate Validity & Security Status",
      "Direct Email Address Extraction from Public Footprint",
      "Corporate Social Profiles (LinkedIn, X, Facebook)",
    ],
    desc: "Checks company domains for working email mail exchange (MX) servers, pulls public contact points, and verifies website accessibility.",
  },
  {
    id: "sic_classifier_ai",
    name: "SIC Code AI Trade Classifier",
    category: "Machine Learning Trade Classification",
    authority: "Outreach Fast Edge Inference",
    LogoComponent: ClassifierAiLogo,
    endpoint: "https://ai.outreach.internal/v1/leads/sic-classifier",
    latency: "18ms",
    cadence: "Instant text mapping",
    fieldsEnriched: [
      "5-Digit Primary UK SIC 2007 Code",
      "Secondary Trading Classifications",
      "Classification Confidence Score",
      "Sector & Industry Standardization",
    ],
    desc: "Model 'Fast-SIC-Distil-v2' translates unstructured descriptions (e.g. 'artisan coffee roaster') into official statutory industry categories.",
  },
  {
    id: "lead_fit_ai",
    name: "Outreach Lead Scoring AI",
    category: "Reasoning & Solvency Evaluation",
    authority: "Outreach Lead Intelligence Cluster",
    LogoComponent: LeadFitLogo,
    endpoint: "https://ai.outreach.internal/v1/leads/fit-scoring",
    latency: "48ms",
    cadence: "Real-time evaluation",
    fieldsEnriched: [
      "Ideal Customer Profile (ICP) Fit Score (0-100)",
      "Financial Health & Balance Sheet Growth Signals",
      "Officer Continuity & Tenure Signals",
      "Headcount Expansion Indicators",
    ],
    desc: "Model 'Outreach-LeadReasoning-70B v2.4' performs chain-of-thought analysis on company accounts to predict commercial viability and outreach fit.",
  },
];

// Interactive Pop-up Modal showing all things used for enrichment
export function EnrichmentSourcesModal({ open, onClose }) {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");

  if (!open) return null;

  const categories = ["All", "Official Statutory Register", "Statutory Compliance", "Officer Intelligence", "Digital Presence & Email Verification", "Machine Learning Trade Classification"];

  const filtered = ENRICHMENT_SOURCES.filter((s) => {
    const matchCat = selectedCategory === "All" || s.category === selectedCategory;
    const q = search.trim().toLowerCase();
    const matchQ = !q || s.name.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q) || s.fieldsEnriched.some((f) => f.toLowerCase().includes(q));
    return matchCat && matchQ;
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="enrichment-modal-title"
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(15, 23, 42, 0.65)",
        backdropFilter: "blur(4px)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        className="ui-card"
        style={{
          width: "100%",
          maxWidth: 860,
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          background: "#FFFFFF",
          borderRadius: 14,
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
          overflow: "hidden",
          border: `1px solid ${C.border}`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 24px",
            borderBottom: `1px solid ${C.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "#F8FAFC",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: "#0C8C7D",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#FFFFFF",
                boxShadow: "0 2px 8px rgba(12,140,125,.3)",
              }}
            >
              <ShieldCheck size={22} />
            </div>
            <div>
              <div
                style={{
                  ...head,
                  fontSize: 11.5,
                  fontWeight: 800,
                  color: "#0C8C7D",
                  letterSpacing: ".08em",
                  textTransform: "uppercase",
                }}
              >
                Data Enrichment Pipeline
              </div>
              <h2 id="enrichment-modal-title" style={{ ...head, margin: 0, fontSize: 18, fontWeight: 700, color: C.ink }}>
                APIs & Sources Used to Enrich Your Contacts
              </h2>
            </div>
          </div>
          <button
            type="button"
            className="ui-btn ui-btn--ghost ui-btn--sm"
            onClick={onClose}
            aria-label="Close pop-up"
          >
            <X size={18} />
          </button>
        </div>

        {/* Top Filter & Search */}
        <div
          style={{
            padding: "14px 24px",
            background: "#FFFFFF",
            borderBottom: `1px solid ${C.borderLight}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, overflowX: "auto" }}>
            <span style={{ ...text, fontSize: 12, fontWeight: 600, color: C.slate, marginRight: 4 }}>
              Filter:
            </span>
            {categories.slice(0, 4).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                style={{
                  ...text,
                  fontSize: 12,
                  padding: "4px 10px",
                  borderRadius: 6,
                  border: `1px solid ${selectedCategory === cat ? "#0C8C7D" : C.border}`,
                  background: selectedCategory === cat ? "#0C8C7D" : "#FFFFFF",
                  color: selectedCategory === cat ? "#FFFFFF" : C.textInk,
                  cursor: "pointer",
                  fontWeight: selectedCategory === cat ? 600 : 500,
                  whiteSpace: "nowrap",
                }}
              >
                {cat}
              </button>
            ))}
          </div>

          <div style={{ position: "relative", minWidth: 200, maxWidth: 280, flex: "1 1 200px" }}>
            <Search
              size={13}
              style={{
                position: "absolute",
                left: 10,
                top: "50%",
                transform: "translateY(-50%)",
                color: C.slate,
              }}
            />
            <input
              type="search"
              className="ui-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search APIs or fields..."
              style={{
                paddingLeft: 30,
                height: 32,
                fontSize: 12,
                borderRadius: 6,
                width: "100%",
              }}
            />
          </div>
        </div>

        {/* Content List */}
        <div
          className="ui-scroll"
          style={{
            padding: 24,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 14,
            flex: 1,
            background: "#FAFBFD",
          }}
        >
          {filtered.map((item) => {
            const LogoComp = item.LogoComponent;
            return (
              <div
                key={item.id}
                style={{
                  background: "#FFFFFF",
                  border: `1px solid ${C.border}`,
                  borderRadius: 10,
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ flexShrink: 0 }}>
                      <LogoComp size={34} />
                    </div>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <h4 style={{ ...head, margin: 0, fontSize: 15, fontWeight: 700, color: C.ink }}>
                          {item.name}
                        </h4>
                        <span
                          style={{
                            ...text,
                            fontSize: 10.5,
                            fontWeight: 700,
                            padding: "2px 7px",
                            borderRadius: 4,
                            background: "#DCFCE7",
                            color: "#15803D",
                            textTransform: "uppercase",
                            letterSpacing: ".04em",
                          }}
                        >
                          {item.category}
                        </span>
                      </div>
                      <div style={{ ...text, fontSize: 12, color: C.slate, marginTop: 2 }}>
                        {item.authority} · <span style={{ color: "#0C8C7D", fontWeight: 600 }}>{item.latency} latency</span> · {item.cadence}
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 11,
                      color: C.slate,
                      background: "#F1F5F9",
                      padding: "4px 8px",
                      borderRadius: 4,
                      maxWidth: 280,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={item.endpoint}
                  >
                    {item.endpoint}
                  </div>
                </div>

                <div style={{ ...text, fontSize: 13, color: C.textInk, lineHeight: 1.45 }}>
                  {item.desc}
                </div>

                {/* Fields Enriched Chips */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
                  <span style={{ ...text, fontSize: 11.5, fontWeight: 600, color: C.slate, marginRight: 2 }}>
                    Enriches:
                  </span>
                  {item.fieldsEnriched.map((field) => (
                    <span
                      key={field}
                      style={{
                        ...text,
                        fontSize: 11,
                        background: "#F8FAFC",
                        border: `1px solid ${C.borderLight}`,
                        color: C.ink,
                        padding: "2px 7px",
                        borderRadius: 4,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <Check size={11} color="#16A34A" />
                      {field}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "14px 24px",
            borderTop: `1px solid ${C.border}`,
            background: "#FFFFFF",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, ...text, fontSize: 12, color: C.slate }}>
            <Info size={14} color="#0C8C7D" />
            <span>All 9 APIs run automatically during file import, list creation, and contact checks with zero extra API key configuration.</span>
          </div>
          <button
            type="button"
            className="ui-btn ui-btn--primary ui-btn--sm"
            onClick={onClose}
            style={{ background: "#0C8C7D", borderColor: "#0C8C7D", padding: "6px 18px" }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// Compact banner / tab shown when users are on Import or Lists
export function EnrichmentBanner({ onOpenModal }) {
  return (
    <div
      style={{
        background: "linear-gradient(135deg, #F0FDF4 0%, #ECFDF5 100%)",
        border: "1px solid #BBF7D0",
        borderRadius: 10,
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 14,
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: "#16A34A",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#FFFFFF",
            flexShrink: 0,
          }}
        >
          <Sparkles size={16} />
        </div>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ ...head, fontSize: 13.5, fontWeight: 700, color: "#14532D" }}>
              Active Contact Enrichment Pipeline
            </span>
            <span
              style={{
                ...text,
                fontSize: 10.5,
                background: "#DCFCE7",
                color: "#166534",
                border: "1px solid #86EFAC",
                padding: "1px 6px",
                borderRadius: 4,
                fontWeight: 700,
              }}
            >
              9 Verified APIs
            </span>
          </div>
          <div style={{ ...text, fontSize: 12, color: "#166534", marginTop: 2 }}>
            Imported records are automatically checked and enriched using Companies House, TPS screening, officer registers, PAF coordinates, and AI models.
          </div>
        </div>
      </div>

      <button
        type="button"
        className="ui-btn ui-btn--secondary ui-btn--sm"
        onClick={onOpenModal}
        style={{
          background: "#FFFFFF",
          borderColor: "#86EFAC",
          color: "#15803D",
          fontWeight: 600,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          padding: "6px 14px",
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        }}
      >
        <ShieldCheck size={14} color="#16A34A" />
        View All Enrichment Sources & APIs
      </button>
    </div>
  );
}
