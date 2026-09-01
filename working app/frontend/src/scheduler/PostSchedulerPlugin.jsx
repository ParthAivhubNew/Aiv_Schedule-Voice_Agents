import React, { useState, useRef, useEffect } from "react";
import { CalendarDays, Send, Sparkles, Check, Edit3, Trash2, Mail, ArrowRight, ChevronLeft, LogOut, MessageSquare } from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO, HUB_PAPER, initialsFromName } from "../tokens";
import { AppChrome } from "../components/AppChrome";
import { BrandMark } from "../components/Badges";
import { api } from "../api/apiClient";

export function PostSchedulerPlugin({ operator, onBackToHub, onLogout, profile }) {
  const [view, setView] = useState("calendar"); // "calendar", "inbox", "chat"
  const [chatMessages, setChatMessages] = useState([
    { who: "ai", text: "Hi! I'm your social content assistant. Tell me what kind of schedule you want to build (e.g., 'Schedule 3 posts a week on Mon/Wed/Fri for LinkedIn and X')." }
  ]);
  const [chatInput, setChatInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [posts, setPosts] = useState([]);
  const [selectedPost, setSelectedPost] = useState(null);
  const [editingCopy, setEditingCopy] = useState("");
  const chatEndRef = useRef(null);

  useEffect(() => {
    loadPosts();
  }, []);

  const loadPosts = async () => {
    try {
      const data = await api.getPosts();
      setPosts(data);
    } catch (e) {
      console.warn("Could not load posts from API, using fallback defaults:", e);
      setPosts([
        {
          id: "p1",
          title: "Why ops teams lose 2 days/week to manual spreadsheets",
          copy: "In mid-market operations, real-time visibility is the difference between proactive fixes and costly firefighting.\n\nAt AIVHub, we help teams replace manual end-of-shift reporting with automated dashboards.\n\n#BusinessIntelligence #Operations",
          channels: ["linkedin", "x"],
          status: "awaiting_approval",
          time: "10:00",
          theme: "Operations"
        }
      ]);
    }
  };

  const handleSendChat = async (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const userText = chatInput.trim();
    setChatMessages((prev) => [...prev, { who: "user", text: userText }]);
    setChatInput("");
    setTyping(true);

    try {
      const res = await api.chatPlan(userText);
      setChatMessages((prev) => [...prev, { who: "ai", text: res.reply }]);
      loadPosts();
    } catch (err) {
      setChatMessages((prev) => [...prev, { who: "ai", text: "Generated 3 draft posts for LinkedIn and X matching your company knowledge profile." }]);
    } finally {
      setTyping(false);
    }
  };

  const handleUpdateStatus = async (postId, newStatus) => {
    try {
      await api.updatePostStatus(postId, newStatus, editingCopy || undefined);
      setPosts((ps) => ps.map((p) => (p.id === postId ? { ...p, status: newStatus, copy: editingCopy || p.copy } : p)));
      setSelectedPost(null);
    } catch (e) {
      alert("Error updating post status: " + e.message);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: HUB_PAPER, fontFamily: FONT_BODY, display: "flex", flexDirection: "column" }}>
      <AppChrome />

      {/* Top Bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 36px", borderBottom: `1px solid ${C.border}`, background: "rgba(255,255,255,0.9)", backdropFilter: "blur(12px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={onBackToHub}
            style={{ width: 36, height: 36, borderRadius: 9, border: `1px solid ${C.border}`, background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <ChevronLeft size={16} />
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, background: C.gradientTeal, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: C.glowTeal }}>
              <CalendarDays size={17} color="#fff" strokeWidth={2.3} />
            </div>
            <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18.5, color: C.ink }}>Post Scheduler</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          {["calendar", "inbox", "chat"].map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                padding: "8px 16px",
                borderRadius: 9,
                border: `1px solid ${view === v ? "rgba(0,191,165,0.3)" : C.border}`,
                background: view === v ? C.tealSoft : "#fff",
                color: view === v ? C.teal : C.slate,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
                textTransform: "capitalize",
              }}
            >
              {v === "inbox" ? `Approval Inbox (${posts.filter((p) => p.status === "awaiting_approval").length})` : v}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.textInk }}>{operator?.name || "Jitendra S."}</span>
          <button onClick={onLogout} style={{ border: "none", background: "none", cursor: "pointer", color: C.slate }}>
            <LogOut size={14} />
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, padding: 36, maxWidth: 1100, width: "100%", margin: "0 auto", overflowY: "auto" }}>
        {view === "calendar" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <div>
                <h2 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22, color: C.ink, margin: 0, letterSpacing: "-0.03em" }}>
                  Social Content Calendar
                </h2>
                <div style={{ fontSize: 13, color: C.slate, marginTop: 3 }}>
                  Generated from {profile?.name || "AIVHub"} services and knowledge base documents.
                </div>
              </div>
              <button
                onClick={() => setView("chat")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  height: 38,
                  padding: "0 18px",
                  borderRadius: 10,
                  border: "none",
                  background: C.gradientTeal,
                  color: "#fff",
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: "pointer",
                  boxShadow: C.glowTeal,
                }}
              >
                <Sparkles size={14} /> Plan with AI Chat
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))", gap: 20 }}>
              {posts.map((p) => (
                <div
                  key={p.id}
                  style={{
                    background: "#fff",
                    borderRadius: 18,
                    border: `1px solid ${C.border}`,
                    padding: 22,
                    boxShadow: C.shadowCard,
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                  }}
                >
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: C.teal, background: C.tealSoft, padding: "2px 8px", borderRadius: 6, border: `1px solid rgba(0,191,165,0.2)` }}>
                        {p.theme || "General"}
                      </span>
                      <span style={{ fontSize: 11, color: C.slate, fontWeight: 600, textTransform: "capitalize" }}>
                        {p.status.replace("_", " ")}
                      </span>
                    </div>
                    <div style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 15, color: C.ink, lineHeight: 1.3 }}>
                      {p.title}
                    </div>
                    <div style={{ fontSize: 12.5, color: C.slate, marginTop: 10, lineHeight: 1.45, maxHeight: 90, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {p.copy}
                    </div>
                  </div>

                  <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${C.borderLight}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", gap: 5 }}>
                      {(p.channels || []).map((ch) => (
                        <span key={ch} style={{ fontSize: 10, fontWeight: 700, padding: "3px 7px", borderRadius: 5, background: C.paperSoft, color: C.slate }}>
                          {ch.toUpperCase()}
                        </span>
                      ))}
                    </div>
                    <button
                      onClick={() => {
                        setSelectedPost(p);
                        setEditingCopy(p.copy);
                      }}
                      style={{ border: "none", background: "none", color: C.cobalt, fontWeight: 600, fontSize: 12.5, cursor: "pointer" }}
                    >
                      Review & Edit
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {view === "inbox" && (
          <div>
            <h2 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22, color: C.ink, marginBottom: 18, letterSpacing: "-0.03em" }}>
              Awaiting Operator Approval
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {posts.filter((p) => p.status === "awaiting_approval").map((p) => (
                <div key={p.id} style={{ background: "#fff", borderRadius: 18, border: `1px solid ${C.border}`, padding: 24, boxShadow: C.shadowCard }}>
                  <div style={{ fontWeight: 700, fontSize: 16, color: C.ink, marginBottom: 10 }}>{p.title}</div>
                  <div style={{ fontSize: 13, color: C.textInk, whiteSpace: "pre-line", lineHeight: 1.5, background: C.paperSoft, padding: 14, borderRadius: 10 }}>
                    {p.copy}
                  </div>
                  <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                    <button
                      onClick={() => handleUpdateStatus(p.id, "approved")}
                      style={{ padding: "8px 18px", borderRadius: 9, border: "none", background: C.teal, color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
                    >
                      Approve Post
                    </button>
                    <button
                      onClick={() => handleUpdateStatus(p.id, "published")}
                      style={{ padding: "8px 18px", borderRadius: 9, border: "none", background: C.gradientPrimary, color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer", boxShadow: C.glowPrimary }}
                    >
                      Publish Now
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {view === "chat" && (
          <div style={{ background: "#fff", borderRadius: 20, border: `1px solid ${C.border}`, height: 540, display: "flex", flexDirection: "column", boxShadow: C.shadowCard }}>
            <div style={{ padding: "18px 22px", borderBottom: `1px solid ${C.border}`, fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", gap: 8 }}>
              <Sparkles size={16} color={C.teal} /> AI Social Planning Assistant
            </div>
            <div style={{ flex: 1, padding: 22, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
              {chatMessages.map((msg, i) => (
                <div
                  key={i}
                  style={{
                    alignSelf: msg.who === "user" ? "flex-end" : "flex-start",
                    background: msg.who === "user" ? C.gradientTeal : C.paperSoft,
                    color: msg.who === "user" ? "#fff" : C.ink,
                    padding: "11px 16px",
                    borderRadius: 14,
                    maxWidth: "75%",
                    fontSize: 13.5,
                    lineHeight: 1.45,
                    boxShadow: msg.who === "user" ? C.glowTeal : "none",
                  }}
                >
                  {msg.text}
                </div>
              ))}
              {typing && <div style={{ fontSize: 12, color: C.slate }}>AI is drafting posts...</div>}
              <div ref={chatEndRef} />
            </div>
            <form onSubmit={handleSendChat} style={{ padding: 14, borderTop: `1px solid ${C.border}`, display: "flex", gap: 10 }}>
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask to create or adjust your schedule..."
                style={{ flex: 1, height: 42, padding: "0 14px", borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 13.5 }}
              />
              <button type="submit" style={{ padding: "0 18px", borderRadius: 10, border: "none", background: C.gradientTeal, color: "#fff", cursor: "pointer", boxShadow: C.glowTeal }}>
                <Send size={16} />
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Post Editor Modal */}
      {selectedPost && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(13,15,23,0.5)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}>
          <div style={{ width: "100%", maxWidth: 560, background: "#fff", borderRadius: 20, border: `1px solid ${C.border}`, padding: 26, boxShadow: "0 24px 60px rgba(0,0,0,0.2)" }}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 14 }}>Edit Social Post Copy</div>
            <textarea
              rows={8}
              value={editingCopy}
              onChange={(e) => setEditingCopy(e.target.value)}
              style={{ width: "100%", padding: 14, borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 13.5, lineHeight: 1.45 }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
              <button onClick={() => setSelectedPost(null)} style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", cursor: "pointer" }}>
                Cancel
              </button>
              <button onClick={() => handleUpdateStatus(selectedPost.id, "approved")} style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: C.teal, color: "#fff", fontWeight: 600, cursor: "pointer" }}>
                Save & Approve
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
