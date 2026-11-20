import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Headset,
  Menu,
  Search,
  X,
} from "lucide-react";
import { C } from "../tokens";
import { BrandLockup } from "../hub/BrandMark";
import { openSupport } from "../hub/openSupport";
import { SupportHub } from "../hub/SupportHub";
import { ALL_DOCS, DOCS_TREE, findDocByPath, searchDocs } from "./content";
import { DocRenderer } from "./DocRenderer";

export function HelpPage({ initialPath = "/help" }) {
  const [currentPath, setCurrentPath] = useState(() => {
    if (typeof window !== "undefined") {
      const p = window.location.pathname;
      if (p.startsWith("/help")) return p;
      const h = window.location.hash.replace(/^#/, "");
      if (h.startsWith("/help")) return h;
    }
    return initialPath;
  });

  const [activeDoc, setActiveDoc] = useState(() => findDocByPath(currentPath));
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [expandedTrees, setExpandedTrees] = useState({ leads: true });

  // Sync route
  useEffect(() => {
    setActiveDoc(findDocByPath(currentPath));
  }, [currentPath]);

  // Handle browser back/forward
  useEffect(() => {
    const handlePop = () => {
      const p = window.location.pathname;
      if (p.startsWith("/help")) {
        setCurrentPath(p);
      } else {
        const h = window.location.hash.replace(/^#/, "");
        if (h.startsWith("/help")) setCurrentPath(h);
      }
    };
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, []);

  const navigateDoc = (path) => {
    setCurrentPath(path);
    try {
      window.history.pushState(null, "", path);
    } catch (_) {}
    setMobileMenuOpen(false);
    setSearchQuery("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSearchChange = (q) => {
    setSearchQuery(q);
    if (q.trim()) {
      setSearchResults(searchDocs(q));
    } else {
      setSearchResults([]);
    }
  };

  const toggleTree = (id) => {
    setExpandedTrees((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#fff",
        display: "flex",
        flexDirection: "column",
        fontFamily: "'Inter', sans-serif",
      }}
    >
      {/* Top Bar */}
      <header
        style={{
          height: 60,
          borderBottom: `1px solid ${C.border}`,
          padding: "0 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          position: "sticky",
          top: 0,
          zIndex: 80,
          background: "rgba(255, 255, 255, 0.95)",
          backdropFilter: "blur(8px)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {/* Mobile hamburger */}
          <button
            type="button"
            className="ui-icon-btn mobile-only-btn"
            onClick={() => setMobileMenuOpen((o) => !o)}
            aria-label="Toggle navigation menu"
            style={{ display: "none" }}
          >
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              window.location.href = "/";
            }}
            style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}
          >
            <BrandLockup size={26} />
          </a>
          <span style={{ color: C.borderLight, fontSize: 18, margin: "0 2px" }}>/</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, fontSize: 14, color: C.ink }}>
            <BookOpen size={16} color={C.cobalt} />
            <span>Documentation</span>
          </div>
        </div>

        {/* Search */}
        <div style={{ position: "relative", flex: "1 1 320px", maxWidth: 420 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              height: 36,
              padding: "0 10px",
              borderRadius: 8,
              background: C.paperSoft,
              border: `1px solid ${C.border}`,
            }}
          >
            <Search size={15} color={C.slateLight} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search documentation..."
              aria-label="Search documentation"
              style={{
                border: "none",
                background: "transparent",
                outline: "none",
                fontSize: 13,
                color: C.textInk,
                width: "100%",
              }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => handleSearchChange("")}
                style={{ all: "unset", cursor: "pointer", display: "flex", alignItems: "center" }}
              >
                <X size={14} color={C.slate} />
              </button>
            )}
          </div>

          {/* Search Results Dropdown */}
          {searchQuery.trim() && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                left: 0,
                right: 0,
                background: "#fff",
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                boxShadow: "0 10px 24px rgba(15,23,42,0.12)",
                maxHeight: 340,
                overflowY: "auto",
                zIndex: 90,
                padding: 6,
              }}
            >
              {searchResults.length > 0 ? (
                searchResults.map(({ doc }) => (
                  <button
                    key={doc.id}
                    type="button"
                    onClick={() => navigateDoc(doc.path)}
                    style={{
                      all: "unset",
                      boxSizing: "border-box",
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: 6,
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                      textAlign: "left",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = C.paperSoft; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: C.cobalt }}>{doc.title}</span>
                    <span style={{ fontSize: 12, color: C.slate, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {doc.summary}
                    </span>
                  </button>
                ))
              ) : (
                <div style={{ padding: "16px 12px", textAlign: "center", fontSize: 13, color: C.slate }}>
                  No guides found for "{searchQuery}".
                </div>
              )}
            </div>
          )}
        </div>

        {/* Back to app */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            type="button"
            className="ui-btn ui-btn--ghost"
            onClick={() => openSupport({ plugin: activeDoc?.id || "docs" })}
            title="Support"
          >
            <Headset size={15} /> <span className="hide-narrow">Support</span>
          </button>
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              window.location.href = "/";
            }}
            className="ui-btn ui-btn--secondary"
            style={{ textDecoration: "none" }}
          >
            <ArrowLeft size={14} /> Back to app
          </a>
        </div>
      </header>

      {/* Main Container */}
      <div style={{ flex: 1, display: "flex", position: "relative" }}>
        {/* Left Navigation Tree */}
        <aside
          className={`help-sidebar ${mobileMenuOpen ? "help-sidebar--open" : ""}`}
          style={{
            width: 250,
            flexShrink: 0,
            borderRight: `1px solid ${C.border}`,
            background: "#FAFAFC",
            padding: "24px 12px",
            overflowY: "auto",
            position: "sticky",
            top: 60,
            height: "calc(100vh - 60px)",
            boxSizing: "border-box",
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: C.slateLight, textTransform: "uppercase", letterSpacing: "0.08em", padding: "0 10px 10px" }}>
            Navigation
          </div>
          <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {DOCS_TREE.map((node) => {
              const isSelected = activeDoc?.id === node.id || (node.children && node.children.some((c) => c.id === activeDoc?.id));
              const isChildActive = (cId) => activeDoc?.id === cId;
              const hasChildren = Boolean(node.children && node.children.length);
              const isExpanded = expandedTrees[node.id];

              return (
                <React.Fragment key={node.id}>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <button
                      type="button"
                      onClick={() => navigateDoc(node.doc.path)}
                      style={{
                        all: "unset",
                        boxSizing: "border-box",
                        flex: 1,
                        padding: "7px 10px",
                        borderRadius: 6,
                        fontSize: 13.5,
                        fontWeight: activeDoc?.id === node.id ? 600 : 500,
                        color: activeDoc?.id === node.id ? C.cobalt : C.textInk,
                        background: activeDoc?.id === node.id ? C.cobaltSoft : "transparent",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                      onMouseEnter={(e) => {
                        if (activeDoc?.id !== node.id) e.currentTarget.style.background = C.paperSoft;
                      }}
                      onMouseLeave={(e) => {
                        if (activeDoc?.id !== node.id) e.currentTarget.style.background = "transparent";
                      }}
                    >
                      <span style={{ flex: 1 }}>{node.label}</span>
                    </button>
                    {hasChildren && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleTree(node.id);
                        }}
                        className="ui-icon-btn ui-icon-btn--sm"
                        aria-label="Toggle group"
                        style={{ marginLeft: 2 }}
                      >
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                    )}
                  </div>

                  {hasChildren && isExpanded && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 1, paddingLeft: 18, margin: "2px 0 4px" }}>
                      {node.children.map((child) => (
                        <button
                          key={child.id}
                          type="button"
                          onClick={() => navigateDoc(child.doc.path)}
                          style={{
                            all: "unset",
                            boxSizing: "border-box",
                            padding: "6px 10px",
                            borderRadius: 6,
                            fontSize: 13,
                            fontWeight: isChildActive(child.id) ? 600 : 400,
                            color: isChildActive(child.id) ? C.cobalt : C.slate,
                            background: isChildActive(child.id) ? C.cobaltSoft : "transparent",
                            cursor: "pointer",
                          }}
                          onMouseEnter={(e) => {
                            if (!isChildActive(child.id)) e.currentTarget.style.background = C.paperSoft;
                          }}
                          onMouseLeave={(e) => {
                            if (!isChildActive(child.id)) e.currentTarget.style.background = "transparent";
                          }}
                        >
                          {child.label}
                        </button>
                      ))}
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </nav>
        </aside>

        {/* Center Content Column */}
        <main style={{ flex: 1, minWidth: 0, padding: "0 16px" }}>
          <DocRenderer doc={activeDoc} />

          {/* Bottom Support Callout Box */}
          <div
            style={{
              maxWidth: 720,
              margin: "0 auto 64px",
              padding: "20px 24px",
              borderRadius: 12,
              background: C.paperSoft,
              border: `1px solid ${C.border}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 16,
            }}
          >
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: C.ink }}>Still stuck?</div>
              <div style={{ fontSize: 13, color: C.slate, marginTop: 2 }}>
                Report an issue or tell us what went wrong.
              </div>
            </div>
            <button
              type="button"
              className="ui-btn ui-btn--primary"
              onClick={() => openSupport({ plugin: activeDoc?.id || "help", screen: "docs" })}
            >
              <Headset size={15} /> Report an issue
            </button>
          </div>
        </main>

        {/* Right "On this page" Outline */}
        <aside
          className="hide-mobile"
          style={{
            width: 210,
            flexShrink: 0,
            padding: "32px 16px",
            position: "sticky",
            top: 60,
            height: "calc(100vh - 60px)",
            boxSizing: "border-box",
            overflowY: "auto",
          }}
        >
          <div style={{ fontSize: 11.5, fontWeight: 600, color: C.slateLight, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>
            On this page
          </div>
          <nav style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {(activeDoc?.sections || []).map((sec) => (
              <a
                key={sec.id}
                href={`#${sec.id}`}
                style={{
                  fontSize: 13,
                  color: C.slate,
                  textDecoration: "none",
                  lineHeight: 1.4,
                  display: "block",
                  padding: "3px 0",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = C.cobalt; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = C.slate; }}
              >
                {sec.heading}
              </a>
            ))}
          </nav>
        </aside>
      </div>

      {/* Embedded Support Hub so clicking "Report an issue" opens the panel right here */}
      <SupportHub />

      <style>{`
        @media (max-width: 820px) {
          .mobile-only-btn { display: inline-flex !important; }
          .help-sidebar {
            position: fixed !important;
            top: 60px !important;
            left: 0 !important;
            bottom: 0 !important;
            z-index: 100 !important;
            height: calc(100vh - 60px) !important;
            box-shadow: 0 0 24px rgba(0,0,0,0.18) !important;
            transform: translateX(-100%);
            transition: transform 0.2s ease;
          }
          .help-sidebar--open {
            transform: translateX(0) !important;
          }
        }
      `}</style>
    </div>
  );
}
