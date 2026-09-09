import React, { useState, useRef, useEffect } from "react";
import {
  CalendarDays,
  Send,
  Sparkles,
  Check,
  Edit3,
  Trash2,
  Mail,
  ArrowRight,
  ChevronLeft,
  LogOut,
  MessageSquare,
  Image as ImageIcon,
  Download,
  Maximize2,
  RefreshCw,
  Clock,
  Tag,
  Hash,
  Share2,
  CheckCircle2,
  AlertCircle,
  Eye,
  Sliders,
  Layers,
  X,
  Plus,
  ExternalLink
} from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO, HUB_PAPER, initialsFromName, getActiveAiCredentials } from "../tokens";
import { AppChrome } from "../components/AppChrome";
import { api } from "../api/apiClient";

const VISUAL_STYLES = [
  { id: "modern_saas", label: "Modern SaaS", desc: "Clean vector UI, tech isometric gradients" },
  { id: "editorial", label: "8K Photorealistic", desc: "Crisp studio lighting, authentic operations" },
  { id: "minimalist_3d", label: "3D Clay Render", desc: "Soft isometric shapes, smooth pastel colors" },
  { id: "neon_tech", label: "Neon HUD / Tech", desc: "Futuristic dark holographic telemetry" },
  { id: "b2b_ad", label: "B2B Marketing Ad", desc: "High contrast, bold corporate graphic design" },
  { id: "cinematic", label: "Cinematic Drama", desc: "Atmospheric depth, dramatic volumetric light" }
];

const ASPECT_RATIOS = [
  { id: "16:9", label: "16:9 Landscape", desc: "X / Twitter & Blog Hero" },
  { id: "1:1", label: "1:1 Square", desc: "LinkedIn & Instagram Feed" },
  { id: "4:5", label: "4:5 Portrait", desc: "High-Engagement Mobile" },
  { id: "9:16", label: "9:16 Vertical", desc: "Story / Reels" }
];

const QUICK_PROMPT_HOOKS = [
  "Why ops teams lose 2 days/week to manual spreadsheets",
  "Autonomous freight logistics dispatch telemetry dashboard",
  "Real-time production line monitoring vs end-of-shift reports",
  "AI predictive maintenance benchmarks in smart manufacturing",
  "Modern executive operational dashboard with live KPI charts"
];

export function PostSchedulerPlugin({
  operator,
  onBackToHub,
  onLogout,
  profile,
  setProfile,
  commonAi,
  onOpenCommonAi
}) {
  const [view, setView] = useState("studio"); // "calendar", "inbox", "studio", "chat"
  const [posts, setPosts] = useState([]);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);

  // AI Image Studio & Composer State
  const [topicPrompt, setTopicPrompt] = useState(QUICK_PROMPT_HOOKS[0]);
  const [selectedStyle, setSelectedStyle] = useState("modern_saas");
  const [selectedAspect, setSelectedAspect] = useState("16:9");
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [generatedImageUrl, setGeneratedImageUrl] = useState("https://image.pollinations.ai/prompt/Business%20intelligence%20operations%20dashboard%20with%20real-time%20analytics%20modern%20sleek%20SaaS%20vector%20illustration?width=1200&height=675&nologo=true&seed=48192");
  const [generatedImagePrompt, setGeneratedImagePrompt] = useState("");
  const [activeLightbox, setActiveLightbox] = useState(false);

  // Social Package State
  const [isGeneratingPackage, setIsGeneratingPackage] = useState(false);
  const [hook, setHook] = useState("Most operations leaders don't realize this: manual spreadsheets eat 10+ hours a week.");
  const [linkedinCopy, setLinkedinCopy] = useState(`🚀 Why ops teams lose 2 days/week to manual spreadsheets

In mid-market operations, real-time visibility is the difference between proactive decisions and expensive firefighting.

Key insights for ops leaders:
• Eliminate 8+ hours of weekly spreadsheet assembly
• Spot production and dispatch bottlenecks before delivery deadlines
• Empower supervisors with live, decision-ready metrics

How is your team currently tracking daily throughput? Let's discuss in the comments below.`);
  const [xCopy, setXCopy] = useState("Manual reporting shouldn't be running your operations. Real-time dashboards give mid-market teams instant visibility without reporting delay. #OpsEx #BI");
  const [hashtags, setHashtags] = useState(["#Operations", "#BusinessIntelligence", "#Automation", "#B2BTech", "#Logistics"]);
  const [newTagInput, setNewTagInput] = useState("");
  const [cta, setCta] = useState("What's the biggest reporting bottleneck in your operations right now? Drop your thoughts below 👇");
  const [firstComment, setFirstComment] = useState("🔗 See how AIVHub helps operations teams automate daily reporting: https://aivhub.io/demo");
  const [altText, setAltText] = useState("A sleek digital operations intelligence dashboard displaying live delivery metrics.");
  const [targetChannels, setTargetChannels] = useState(["linkedin", "x"]);
  const [activeChannelTab, setActiveChannelTab] = useState("linkedin"); // "linkedin" or "x"
  const [scheduledDate, setScheduledDate] = useState("2026-03-12");
  const [scheduledTime, setScheduledTime] = useState("09:30");

  // Approval Inbox & Editing Drawer State
  const [selectedInboxPost, setSelectedInboxPost] = useState(null);
  const [editingCopyText, setEditingCopyText] = useState("");

  // Chat State
  const [chatMessages, setChatMessages] = useState([
    { who: "ai", text: "Hi! I'm your AI Social Content Strategist. I can help brainstorm viral hooks, write multi-platform captions, or plan your weekly publishing calendar." }
  ]);
  const [chatInput, setChatInput] = useState("");
  const [typing, setTyping] = useState(false);
  const chatEndRef = useRef(null);

  const showToast = (msg) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3200);
  };

  useEffect(() => {
    loadPosts();
  }, []);

  const loadPosts = async () => {
    setLoadingPosts(true);
    try {
      const data = await api.getPosts();
      if (data && Array.isArray(data)) {
        setPosts(data);
      }
    } catch (e) {
      console.warn("Could not load posts, keeping local state:", e);
    } finally {
      setLoadingPosts(false);
    }
  };

  // 1. Generate Visual Only
  const handleGenerateImage = async () => {
    if (!topicPrompt.trim()) return;
    setIsGeneratingImage(true);
    try {
      let imgConf = {};
      try {
        const s = localStorage.getItem("aivhub_scheduler_ai");
        if (s) imgConf = JSON.parse(s);
      } catch (_) {}
      const res = await api.generateImage({
        prompt: topicPrompt,
        style: selectedStyle,
        aspect_ratio: selectedAspect,
        provider: imgConf.imageProvider || "pollinations",
        image_provider: imgConf.imageProvider || "pollinations",
        api_key: imgConf.imageApiKey || "",
        image_api_key: imgConf.imageApiKey || "",
        model: imgConf.imageModel || "",
        image_model: imgConf.imageModel || "",
        base_url: imgConf.imageBaseUrl || "",
        image_base_url: imgConf.imageBaseUrl || "",
      });
      if (res && res.imageUrl) {
        setGeneratedImageUrl(res.imageUrl);
        setGeneratedImagePrompt(res.imagePrompt || topicPrompt);
        showToast("✓ New visual generated in high-resolution!");
      }
    } catch (err) {
      showToast("⚠️ Failed to generate image: " + err.message);
    } finally {
      setIsGeneratingImage(false);
    }
  };

  // 2. Generate Complete Social Package (Visual + Hooks + Multi-Channel Captions + Hashtags + CTA)
  const handleGenerateCompletePackage = async () => {
    if (!topicPrompt.trim()) return;
    setIsGeneratingPackage(true);
    try {
      const creds = getActiveAiCredentials(commonAi, "scheduler", "postWriter");
      const res = await api.generateSocialPackage({
        topic: topicPrompt,
        style: selectedStyle,
        aspect_ratio: selectedAspect,
        apiKey: creds.apiKey,
        provider: creds.provider,
        model: creds.model,
        baseUrl: creds.baseUrl
      });

      if (res && res.package) {
        const p = res.package;
        if (p.imageUrl) setGeneratedImageUrl(p.imageUrl);
        if (p.hook) setHook(p.hook);
        if (p.linkedin_copy) setLinkedinCopy(p.linkedin_copy);
        if (p.x_copy) setXCopy(p.x_copy);
        if (p.hashtags && Array.isArray(p.hashtags)) setHashtags(p.hashtags);
        if (p.cta) setCta(p.cta);
        if (p.first_comment) setFirstComment(p.first_comment);
        if (p.alt_text) setAltText(p.alt_text);
        showToast("✓ Generated full social media package with visual and captions!");
      }
    } catch (err) {
      showToast("⚠️ Could not generate package: " + err.message);
    } finally {
      setIsGeneratingPackage(false);
    }
  };

  // 3. Submit Post to Approval Inbox
  const handleSubmitToApproval = async () => {
    try {
      const activeCopy = activeChannelTab === "x" ? xCopy : linkedinCopy;
      const fullCopy = `${hook}\n\n${activeCopy}\n\n${cta}\n\n${hashtags.join(" ")}`;
      
      const payload = {
        title: topicPrompt.slice(0, 60),
        hook: hook,
        copy: fullCopy,
        channels: targetChannels,
        status: "awaiting_approval",
        imageUrl: generatedImageUrl,
        imagePrompt: generatedImagePrompt || topicPrompt,
        time: scheduledTime,
        theme: "Operations"
      };

      const res = await api.createPost(payload);
      if (res && res.post) {
        setPosts((prev) => [res.post, ...prev]);
        showToast("🎉 Post submitted to Approval Inbox!");
        setView("inbox");
      }
    } catch (err) {
      showToast("⚠️ Failed to submit post: " + err.message);
    }
  };

  // 4. Approval Workflow Handlers
  const handleApprovePost = async (post) => {
    try {
      await api.updatePostStatus(post.id, "scheduled", post.copy);
      setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, status: "scheduled" } : p)));
      setSelectedInboxPost(null);
      showToast(`✓ Post approved and scheduled for ${post.time || "10:00"}!`);
    } catch (e) {
      showToast("⚠️ Error approving post: " + e.message);
    }
  };

  const handleRejectPost = async (post) => {
    try {
      await api.deletePost(post.id);
      setPosts((prev) => prev.filter((p) => p.id !== post.id));
      setSelectedInboxPost(null);
      showToast("Post discarded.");
    } catch (e) {
      showToast("⚠️ Error deleting post: " + e.message);
    }
  };

  const handleSaveEditedCopy = async () => {
    if (!selectedInboxPost) return;
    try {
      await api.updatePostStatus(selectedInboxPost.id, selectedInboxPost.status, editingCopyText);
      setPosts((prev) => prev.map((p) => (p.id === selectedInboxPost.id ? { ...p, copy: editingCopyText } : p)));
      setSelectedInboxPost({ ...selectedInboxPost, copy: editingCopyText });
      showToast("✓ Copy updated successfully!");
    } catch (e) {
      showToast("⚠️ Failed to save copy: " + e.message);
    }
  };

  // Tag helper
  const handleRemoveTag = (tagToRemove) => {
    setHashtags(hashtags.filter((t) => t !== tagToRemove));
  };

  const handleAddTag = (e) => {
    e.preventDefault();
    if (!newTagInput.trim()) return;
    let t = newTagInput.trim();
    if (!t.startsWith("#")) t = "#" + t;
    if (!hashtags.includes(t)) {
      setHashtags([...hashtags, t]);
    }
    setNewTagInput("");
  };

  // Chat Assistant
  const handleSendChat = async (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const userText = chatInput.trim();
    setChatMessages((prev) => [...prev, { who: "user", text: userText }]);
    setChatInput("");
    setTyping(true);

    try {
      const creds = getActiveAiCredentials(commonAi, "scheduler", "postWriter");
      const res = await api.chatPlan({
        text: userText,
        apiKey: creds.apiKey,
        provider: creds.provider,
        model: creds.model,
        baseUrl: creds.baseUrl
      });
      setChatMessages((prev) => [...prev, { who: "ai", text: res.reply }]);
      if (res.posts && res.posts.length > 0) {
        loadPosts();
      }
    } catch (err) {
      setChatMessages((prev) => [...prev, { who: "ai", text: `⚠️ AI Chat notice: ${err.message || "Could not reach content assistant."}` }]);
    } finally {
      setTyping(false);
      setTimeout(() => {
        if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: "smooth" });
      }, 100);
    }
  };

  const awaitingCount = posts.filter((p) => p.status === "awaiting_approval").length;
  const scheduledCount = posts.filter((p) => p.status === "scheduled").length;

  return (
    <div style={{ minHeight: "100vh", background: HUB_PAPER, fontFamily: FONT_BODY, display: "flex", flexDirection: "column" }}>
      <AppChrome />

      {/* Toast Notification */}
      {toastMsg && (
        <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 9999, background: C.ink, color: "#fff", padding: "12px 20px", borderRadius: 10, boxShadow: "0 10px 30px rgba(0,0,0,0.2)", fontSize: 13.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
          <Sparkles size={16} color="#00BFA5" /> {toastMsg}
        </div>
      )}

      {/* Lightbox Modal */}
      {activeLightbox && (
        <div onClick={() => setActiveLightbox(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: 30, cursor: "zoom-out" }}>
          <div style={{ position: "relative", maxWidth: "90vw", maxHeight: "90vh" }}>
            <img src={generatedImageUrl} alt={topicPrompt} style={{ maxWidth: "100%", maxHeight: "88vh", borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }} />
            <button onClick={() => setActiveLightbox(false)} style={{ position: "absolute", top: -14, right: -14, background: "#fff", border: "none", borderRadius: 999, width: 32, height: 32, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.3)" }}>
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      {/* Top Header Bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 32px", borderBottom: `1px solid ${C.border}`, background: "rgba(255,255,255,0.95)", backdropFilter: "blur(12px)", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={onBackToHub}
            style={{ width: 36, height: 36, borderRadius: 9, border: `1px solid ${C.border}`, background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
            title="Return to Workspace Hub"
          >
            <ChevronLeft size={16} />
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, background: C.gradientTeal, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: C.glowTeal }}>
              <CalendarDays size={17} color="#fff" strokeWidth={2.3} />
            </div>
            <div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: C.ink, lineHeight: 1.2 }}>Post Scheduler & Creative Engine</div>
              <div style={{ fontSize: 11, color: C.slate }}>Visuals · Multi-Channel Captions · Approval · Scheduling</div>
            </div>
          </div>
        </div>

        {/* Top Navigation Tabs */}
        <div style={{ display: "flex", gap: 6, background: HUB_PAPER, padding: 4, borderRadius: 12, border: `1px solid ${C.border}` }}>
          {[
            { id: "studio", label: "AI Image Studio & Composer", icon: ImageIcon },
            { id: "inbox", label: `Approval Inbox (${awaitingCount})`, icon: CheckCircle2, badge: awaitingCount > 0 ? awaitingCount : null },
            { id: "calendar", label: `Content Calendar (${scheduledCount})`, icon: CalendarDays },
            { id: "chat", label: "AI Social Assistant", icon: MessageSquare }
          ].map((tab) => {
            const Icon = tab.icon;
            const active = view === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setView(tab.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "8px 16px",
                  borderRadius: 9,
                  border: "none",
                  background: active ? "#fff" : "transparent",
                  color: active ? C.ink : C.slate,
                  fontSize: 12.5,
                  fontWeight: active ? 700 : 500,
                  cursor: "pointer",
                  boxShadow: active ? "0 2px 6px rgba(0,0,0,0.06)" : "none",
                  transition: "all 0.15s"
                }}
              >
                <Icon size={14} color={active ? C.teal : C.slate} />
                <span>{tab.label}</span>
                {tab.badge && (
                  <span style={{ fontSize: 10.5, fontWeight: 800, padding: "1px 6px", borderRadius: 999, background: "#F59E0B", color: "#fff" }}>
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* User Info */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 999, background: C.gradientTeal, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11, fontWeight: 700 }}>
            {initialsFromName(operator?.name)}
          </div>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: C.textInk }}>{operator?.name || "Operator"}</span>
          <button onClick={onLogout} style={{ border: "none", background: "none", cursor: "pointer", color: C.slate, padding: 4 }} title="Sign Out">
            <LogOut size={14} />
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* VIEW 1: AI IMAGE STUDIO & SOCIAL COMPOSER */}
      {/* ========================================================================= */}
      {view === "studio" && (
        <div style={{ flex: 1, padding: "26px 36px", maxWidth: 1400, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.15fr", gap: 28 }}>
            
            {/* LEFT COLUMN: Visual Generation Canvas */}
            <div style={{ background: "#fff", borderRadius: 18, border: `1px solid ${C.border}`, padding: 22, boxShadow: C.shadowCard, display: "flex", flexDirection: "column", gap: 18 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: C.ink, display: "flex", alignItems: "center", gap: 8 }}>
                    <ImageIcon size={17} color={C.teal} /> 1. Visual Studio & Creative Prompt
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: C.teal, background: C.tealSoft, padding: "2px 8px", borderRadius: 6 }}>
                    Flux AI Engine (Zero Setup)
                  </span>
                </div>
                <div style={{ fontSize: 12, color: C.slate, marginTop: 3 }}>
                  Type any visual concept or select an operational creative hook below.
                </div>
              </div>

              {/* Prompt Textarea */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <textarea
                  value={topicPrompt}
                  onChange={(e) => setTopicPrompt(e.target.value)}
                  placeholder="Describe your social image creative or topic..."
                  rows={3}
                  style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 13.5, fontFamily: FONT_BODY, outline: "none", resize: "vertical", boxSizing: "border-box", background: HUB_PAPER }}
                />
                
                {/* Quick Inspiration Pills */}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {QUICK_PROMPT_HOOKS.slice(0, 3).map((hookText, i) => (
                    <button
                      key={i}
                      onClick={() => setTopicPrompt(hookText)}
                      style={{ padding: "4px 10px", borderRadius: 999, border: `1px solid ${C.border}`, background: "#fff", color: C.slate, fontSize: 11, cursor: "pointer", textAlign: "left" }}
                    >
                      {hookText.slice(0, 38)}...
                    </button>
                  ))}
                </div>
              </div>

              {/* Visual Style Selector */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                  <Sliders size={13} /> Visual Style Aesthetic
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                  {VISUAL_STYLES.map((st) => (
                    <button
                      key={st.id}
                      onClick={() => setSelectedStyle(st.id)}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: `1.5px solid ${selectedStyle === st.id ? C.teal : C.border}`,
                        background: selectedStyle === st.id ? C.tealSoft : "#fff",
                        color: selectedStyle === st.id ? C.teal : C.ink,
                        cursor: "pointer",
                        textAlign: "left",
                        display: "flex",
                        flexDirection: "column",
                        gap: 2
                      }}
                    >
                      <span style={{ fontSize: 11.5, fontWeight: 700 }}>{st.label}</span>
                      <span style={{ fontSize: 9.5, color: C.slate, lineHeight: 1.2 }}>{st.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Aspect Ratio */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                  <Layers size={13} /> Aspect Ratio & Dimensions
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {ASPECT_RATIOS.map((ar) => (
                    <button
                      key={ar.id}
                      onClick={() => setSelectedAspect(ar.id)}
                      style={{
                        flex: 1,
                        padding: "7px 10px",
                        borderRadius: 8,
                        border: `1.5px solid ${selectedAspect === ar.id ? C.teal : C.border}`,
                        background: selectedAspect === ar.id ? C.tealSoft : "#fff",
                        color: selectedAspect === ar.id ? C.teal : C.ink,
                        fontSize: 11.5,
                        fontWeight: 700,
                        cursor: "pointer"
                      }}
                    >
                      {ar.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Live Rendered Canvas */}
              <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", border: `1px solid ${C.border}`, background: "#111", minHeight: 240, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {isGeneratingImage ? (
                  <div style={{ color: "#fff", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: 40 }}>
                    <RefreshCw size={24} className="animate-spin" color={C.teal} />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>Synthesizing visual creative via Flux AI...</span>
                  </div>
                ) : (
                  <>
                    <img
                      src={generatedImageUrl}
                      alt={topicPrompt}
                      style={{ width: "100%", height: "auto", maxHeight: 300, objectFit: "cover", display: "block" }}
                    />
                    <div style={{ position: "absolute", bottom: 10, right: 10, display: "flex", gap: 6 }}>
                      <button
                        onClick={() => setActiveLightbox(true)}
                        style={{ padding: "6px 10px", borderRadius: 6, background: "rgba(0,0,0,0.75)", color: "#fff", border: "none", cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}
                        title="View Fullscreen"
                      >
                        <Maximize2 size={12} /> Lightbox
                      </button>
                      <a
                        href={generatedImageUrl}
                        target="_blank"
                        rel="noreferrer"
                        download="social_graphic.png"
                        style={{ padding: "6px 10px", borderRadius: 6, background: "rgba(0,0,0,0.75)", color: "#fff", textDecoration: "none", fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}
                        title="Download Graphic"
                      >
                        <Download size={12} /> Download
                      </a>
                    </div>
                  </>
                )}
              </div>

              {/* Action Buttons for Image */}
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  onClick={handleGenerateImage}
                  disabled={isGeneratingImage || isGeneratingPackage}
                  style={{ flex: 1, height: 42, borderRadius: 10, border: `1px solid ${C.teal}`, background: "#fff", color: C.teal, fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                >
                  <RefreshCw size={14} className={isGeneratingImage ? "animate-spin" : ""} />
                  {isGeneratingImage ? "Rendering..." : "Regenerate Visual"}
                </button>
                <button
                  onClick={handleGenerateCompletePackage}
                  disabled={isGeneratingImage || isGeneratingPackage}
                  style={{ flex: 1.5, height: 42, borderRadius: 10, border: "none", background: C.gradientTeal, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, boxShadow: C.glowTeal }}
                >
                  <Sparkles size={14} />
                  {isGeneratingPackage ? "Writing Social Package..." : "Generate Captions & Hashtags"}
                </button>
              </div>
            </div>

            {/* RIGHT COLUMN: Multi-Channel Post Package Composer */}
            <div style={{ background: "#fff", borderRadius: 18, border: `1px solid ${C.border}`, padding: 22, boxShadow: C.shadowCard, display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, color: C.ink, display: "flex", alignItems: "center", gap: 8 }}>
                  <Share2 size={17} color={C.teal} /> 2. Multi-Channel Captions, Hashtags & CTA
                </div>
                <div style={{ fontSize: 12, color: C.slate, marginTop: 3 }}>
                  Preview and customize the exact copy formatted for LinkedIn and X before submission.
                </div>
              </div>

              {/* Platform Switcher & Live Character Count */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${C.borderLight}`, paddingBottom: 10 }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => setActiveChannelTab("linkedin")}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 8,
                      border: "none",
                      background: activeChannelTab === "linkedin" ? "#0A66C2" : HUB_PAPER,
                      color: activeChannelTab === "linkedin" ? "#fff" : C.ink,
                      fontWeight: 700,
                      fontSize: 12.5,
                      cursor: "pointer"
                    }}
                  >
                    LinkedIn Format
                  </button>
                  <button
                    onClick={() => setActiveChannelTab("x")}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 8,
                      border: "none",
                      background: activeChannelTab === "x" ? "#000000" : HUB_PAPER,
                      color: activeChannelTab === "x" ? "#fff" : C.ink,
                      fontWeight: 700,
                      fontSize: 12.5,
                      cursor: "pointer"
                    }}
                  >
                    X (Twitter) Format
                  </button>
                </div>

                {/* Character Counter */}
                <div style={{ fontSize: 11.5, fontWeight: 700, color: activeChannelTab === "x" && xCopy.length > 280 ? C.redSolid : C.slate }}>
                  {activeChannelTab === "x" ? `${xCopy.length} / 280 chars` : `${linkedinCopy.length} chars`}
                </div>
              </div>

              {/* Scroll-Stopping Hook */}
              <div>
                <label style={{ fontSize: 11.5, fontWeight: 700, color: C.ink, display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                  🪝 Scroll-Stopping Hook (First 1-2 Lines)
                </label>
                <input
                  type="text"
                  value={hook}
                  onChange={(e) => setHook(e.target.value)}
                  style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: FONT_BODY, boxSizing: "border-box", background: HUB_PAPER }}
                />
              </div>

              {/* Active Platform Copy */}
              <div>
                <label style={{ fontSize: 11.5, fontWeight: 700, color: C.ink, display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                  📝 {activeChannelTab === "linkedin" ? "LinkedIn Caption (Structured Storytelling)" : "X (Twitter) Punchy Caption"}
                </label>
                <textarea
                  value={activeChannelTab === "linkedin" ? linkedinCopy : xCopy}
                  onChange={(e) => activeChannelTab === "linkedin" ? setLinkedinCopy(e.target.value) : setXCopy(e.target.value)}
                  rows={activeChannelTab === "linkedin" ? 8 : 4}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: FONT_BODY, lineHeight: 1.5, outline: "none", resize: "vertical", boxSizing: "border-box" }}
                />
              </div>

              {/* Smart Hashtags with 1-Click Removal */}
              <div>
                <label style={{ fontSize: 11.5, fontWeight: 700, color: C.ink, display: "flex", alignItems: "center", gap: 4, marginBottom: 6 }}>
                  <Hash size={13} color={C.teal} /> Smart Hashtags ({hashtags.length})
                </label>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  {hashtags.map((tag) => (
                    <span
                      key={tag}
                      style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 9px", borderRadius: 6, background: "#EFF6FF", color: "#1D4ED8", fontSize: 11.5, fontWeight: 600, border: "1px solid #DBEAFE" }}
                    >
                      {tag}
                      <button
                        onClick={() => handleRemoveTag(tag)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "#60A5FA", padding: 0, display: "flex" }}
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                  
                  {/* Add Tag Form */}
                  <form onSubmit={handleAddTag} style={{ display: "inline-flex", gap: 4 }}>
                    <input
                      type="text"
                      placeholder="+ Add tag..."
                      value={newTagInput}
                      onChange={(e) => setNewTagInput(e.target.value)}
                      style={{ padding: "3px 8px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 11.5, width: 90 }}
                    />
                  </form>
                </div>
              </div>

              {/* Call To Action & First Comment Link */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, marginBottom: 4, display: "block" }}>
                    🎯 Engagement CTA
                  </label>
                  <input
                    type="text"
                    value={cta}
                    onChange={(e) => setCta(e.target.value)}
                    style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12, boxSizing: "border-box" }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, marginBottom: 4, display: "block" }}>
                    💬 First Comment (Link in Bio)
                  </label>
                  <input
                    type="text"
                    value={firstComment}
                    onChange={(e) => setFirstComment(e.target.value)}
                    style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12, boxSizing: "border-box" }}
                  />
                </div>
              </div>

              {/* Publishing Schedule & Channel Toggles */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: HUB_PAPER, padding: "12px 16px", borderRadius: 10, border: `1px solid ${C.borderLight}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Clock size={15} color={C.teal} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: C.ink }}>Schedule Slot:</span>
                  <input
                    type="date"
                    value={scheduledDate}
                    onChange={(e) => setScheduledDate(e.target.value)}
                    style={{ padding: "4px 8px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12 }}
                  />
                  <input
                    type="time"
                    value={scheduledTime}
                    onChange={(e) => setScheduledTime(e.target.value)}
                    style={{ padding: "4px 8px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12 }}
                  />
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  {["linkedin", "x"].map((ch) => (
                    <label key={ch} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, textTransform: "capitalize", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={targetChannels.includes(ch)}
                        onChange={(e) => {
                          if (e.target.checked) setTargetChannels([...targetChannels, ch]);
                          else setTargetChannels(targetChannels.filter((c) => c !== ch));
                        }}
                      />
                      {ch}
                    </label>
                  ))}
                </div>
              </div>

              {/* Primary Action Button */}
              <button
                onClick={handleSubmitToApproval}
                style={{
                  height: 46,
                  borderRadius: 10,
                  border: "none",
                  background: C.gradientTeal,
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  boxShadow: C.glowTeal,
                  marginTop: 4
                }}
              >
                <CheckCircle2 size={16} /> Submit to Approval Inbox ({awaitingCount} pending)
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW 2: APPROVAL INBOX (REVIEW, EDIT, APPROVE & SCHEDULE) */}
      {/* ========================================================================= */}
      {view === "inbox" && (
        <div style={{ flex: 1, padding: "28px 36px", maxWidth: 1200, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div>
              <h2 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22, color: C.ink, margin: 0, letterSpacing: "-0.02em" }}>
                Approval Inbox ({awaitingCount} Pending Review)
              </h2>
              <div style={{ fontSize: 13, color: C.slate, marginTop: 4 }}>
                Review generated visuals, fine-tune copy, and approve posts for automated multi-channel publication.
              </div>
            </div>
            <button
              onClick={() => setView("studio")}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, background: C.gradientTeal, color: "#fff", border: "none", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}
            >
              <Plus size={14} /> Create New Post
            </button>
          </div>

          {awaitingCount === 0 ? (
            <div style={{ background: "#fff", borderRadius: 16, border: `1px solid ${C.border}`, padding: 48, textAlign: "center", color: C.slate }}>
              <CheckCircle2 size={42} color={C.teal} style={{ margin: "0 auto 12px" }} />
              <div style={{ fontWeight: 700, fontSize: 16, color: C.ink }}>All Caught Up!</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>No posts currently awaiting approval. Generate a new post in the AI Image Studio.</div>
              <button
                onClick={() => setView("studio")}
                style={{ marginTop: 16, padding: "8px 18px", borderRadius: 8, background: C.gradientTeal, color: "#fff", border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
              >
                Go to AI Image Studio
              </button>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 20 }}>
              {posts.filter((p) => p.status === "awaiting_approval").map((post) => (
                <div
                  key={post.id}
                  style={{
                    background: "#fff",
                    borderRadius: 16,
                    border: `1px solid ${C.border}`,
                    overflow: "hidden",
                    boxShadow: C.shadowCard,
                    display: "flex",
                    flexDirection: "column"
                  }}
                >
                  {/* Post Image Thumbnail */}
                  {post.imageUrl && (
                    <div style={{ height: 190, background: "#18181B", position: "relative", overflow: "hidden" }}>
                      <img src={post.imageUrl} alt={post.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      <div style={{ position: "absolute", top: 10, left: 10, display: "flex", gap: 4 }}>
                        {(post.channels || ["linkedin"]).map((ch) => (
                          <span key={ch} style={{ fontSize: 10, fontWeight: 800, padding: "2px 7px", borderRadius: 4, background: "rgba(0,0,0,0.75)", color: "#fff", textTransform: "uppercase" }}>
                            {ch}
                          </span>
                        ))}
                      </div>
                      <span style={{ position: "absolute", top: 10, right: 10, fontSize: 10.5, fontWeight: 800, padding: "3px 8px", borderRadius: 999, background: "#FEF3C7", color: "#B45309" }}>
                        Awaiting Approval
                      </span>
                    </div>
                  )}

                  {/* Post Body & Details */}
                  <div style={{ padding: 18, flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14.5, color: C.ink, lineHeight: 1.3, marginBottom: 8 }}>
                        {post.title}
                      </div>
                      <div style={{ fontSize: 12.5, color: C.slate, lineHeight: 1.45, whiteSpace: "pre-wrap", maxHeight: 110, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {post.copy}
                      </div>
                    </div>

                    <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${C.borderLight}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ fontSize: 11, color: C.slate, display: "flex", alignItems: "center", gap: 4 }}>
                        <Clock size={12} /> {post.time || "10:00"}
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          onClick={() => {
                            setSelectedInboxPost(post);
                            setEditingCopyText(post.copy);
                          }}
                          style={{ padding: "6px 12px", borderRadius: 7, border: `1px solid ${C.border}`, background: "#fff", color: C.ink, fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
                        >
                          <Edit3 size={12} /> Edit
                        </button>
                        <button
                          onClick={() => handleApprovePost(post)}
                          style={{ padding: "6px 14px", borderRadius: 7, border: "none", background: C.gradientTeal, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, boxShadow: C.glowTeal }}
                        >
                          <Check size={13} /> Approve
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Side Drawer: Edit Post Copy Modal */}
          {selectedInboxPost && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", justifyContent: "flex-end" }}>
              <div style={{ width: "100%", maxWidth: 520, background: "#fff", height: "100%", display: "flex", flexDirection: "column", padding: 28, boxSizing: "border-box", boxShadow: "-10px 0 30px rgba(0,0,0,0.15)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${C.border}`, paddingBottom: 16, marginBottom: 20 }}>
                  <div style={{ fontWeight: 700, fontSize: 16, color: C.ink }}>Edit Post Before Approval</div>
                  <button onClick={() => setSelectedInboxPost(null)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
                    <X size={18} />
                  </button>
                </div>

                <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
                  {selectedInboxPost.imageUrl && (
                    <img src={selectedInboxPost.imageUrl} alt="post" style={{ width: "100%", height: 180, objectFit: "cover", borderRadius: 10 }} />
                  )}
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 6, display: "block" }}>Post Copy & Formatting</label>
                    <textarea
                      value={editingCopyText}
                      onChange={(e) => setEditingCopyText(e.target.value)}
                      rows={12}
                      style={{ width: "100%", padding: "12px", borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 13, lineHeight: 1.5, boxSizing: "border-box" }}
                    />
                  </div>
                </div>

                <div style={{ display: "flex", gap: 10, paddingTop: 18, borderTop: `1px solid ${C.border}` }}>
                  <button
                    onClick={() => handleRejectPost(selectedInboxPost)}
                    style={{ padding: "10px 18px", borderRadius: 8, border: `1px solid ${C.red}`, background: "#fff", color: C.red, fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                  >
                    Discard Post
                  </button>
                  <button
                    onClick={handleSaveEditedCopy}
                    style={{ flex: 1, padding: "10px 18px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", color: C.ink, fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                  >
                    Save Changes
                  </button>
                  <button
                    onClick={async () => {
                      await handleSaveEditedCopy();
                      await handleApprovePost({ ...selectedInboxPost, copy: editingCopyText });
                    }}
                    style={{ flex: 1.2, padding: "10px 18px", borderRadius: 8, border: "none", background: C.gradientTeal, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", boxShadow: C.glowTeal }}
                  >
                    Approve & Schedule
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW 3: SOCIAL CONTENT CALENDAR (SCHEDULED & PUBLISHED POSTS) */}
      {/* ========================================================================= */}
      {view === "calendar" && (
        <div style={{ flex: 1, padding: "28px 36px", maxWidth: 1200, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div>
              <h2 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22, color: C.ink, margin: 0, letterSpacing: "-0.02em" }}>
                Social Content Calendar ({scheduledCount} Scheduled)
              </h2>
              <div style={{ fontSize: 13, color: C.slate, marginTop: 4 }}>
                Active scheduled posts queued for publication across LinkedIn and X.
              </div>
            </div>
            <button
              onClick={() => setView("studio")}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, background: C.gradientTeal, color: "#fff", border: "none", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}
            >
              <Plus size={14} /> New Post
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 20 }}>
            {posts.filter((p) => p.status === "scheduled" || p.status === "published").map((post) => (
              <div
                key={post.id}
                style={{
                  background: "#fff",
                  borderRadius: 16,
                  border: `1px solid ${C.border}`,
                  overflow: "hidden",
                  boxShadow: C.shadowCard,
                  display: "flex",
                  flexDirection: "column"
                }}
              >
                {post.imageUrl && (
                  <div style={{ height: 180, background: "#18181B", position: "relative" }}>
                    <img src={post.imageUrl} alt={post.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    <span style={{ position: "absolute", top: 10, right: 10, fontSize: 10.5, fontWeight: 800, padding: "3px 8px", borderRadius: 999, background: "#ECFDF5", color: "#059669", border: "1px solid #A7F3D0" }}>
                      ● Scheduled
                    </span>
                  </div>
                )}
                <div style={{ padding: 18, flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14.5, color: C.ink, marginBottom: 8 }}>{post.title}</div>
                    <div style={{ fontSize: 12.5, color: C.slate, lineHeight: 1.45, whiteSpace: "pre-wrap", maxHeight: 90, overflow: "hidden" }}>
                      {post.copy}
                    </div>
                  </div>
                  <div style={{ marginTop: 14, paddingTop: 10, borderTop: `1px solid ${C.borderLight}`, display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11.5, color: C.slate }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <Clock size={12} color={C.teal} /> Slot: {post.time || "10:00"}
                    </span>
                    <span style={{ fontWeight: 700, color: C.ink }}>
                      {(post.channels || ["linkedin"]).join(", ").toUpperCase()}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW 4: OPEN CONVERSATIONAL AI ASSISTANT CHAT */}
      {/* ========================================================================= */}
      {view === "chat" && (
        <div style={{ flex: 1, padding: "28px 36px", maxWidth: 960, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
          <div style={{ background: "#fff", borderRadius: 18, border: `1px solid ${C.border}`, height: "calc(100vh - 160px)", display: "flex", flexDirection: "column", boxShadow: C.shadowCard }}>
            <div style={{ padding: "16px 22px", borderBottom: `1px solid ${C.border}`, fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Sparkles size={17} color={C.teal} /> AI Social Planning Assistant
              </div>
              <span style={{ fontSize: 11, color: C.slate }}>Unrestricted Conversational Strategy</span>
            </div>

            <div style={{ flex: 1, padding: 22, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14, background: "#FAFAF9" }}>
              {chatMessages.map((msg, i) => (
                <div
                  key={i}
                  style={{
                    alignSelf: msg.who === "user" ? "flex-end" : "flex-start",
                    background: msg.who === "user" ? C.gradientTeal : "#fff",
                    color: msg.who === "user" ? "#fff" : C.ink,
                    padding: "12px 18px",
                    borderRadius: msg.who === "user" ? "16px 16px 4px 16px" : "4px 16px 16px 16px",
                    maxWidth: "75%",
                    fontSize: 13.5,
                    lineHeight: 1.5,
                    border: msg.who === "user" ? "none" : `1px solid ${C.border}`,
                    boxShadow: "0 2px 6px rgba(0,0,0,0.03)",
                    whiteSpace: "pre-wrap"
                  }}
                >
                  {msg.text}
                </div>
              ))}
              {typing && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", color: C.slate, fontSize: 12.5, padding: "8px 12px", background: "#fff", borderRadius: 8, border: `1px solid ${C.border}`, width: "fit-content" }}>
                  <RefreshCw size={14} className="animate-spin" color={C.teal} /> Assistant is reasoning and writing...
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <form onSubmit={handleSendChat} style={{ padding: 14, borderTop: `1px solid ${C.border}`, display: "flex", gap: 10, background: "#fff" }}>
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask about social hooks, request post ideas, or discuss publishing strategy..."
                style={{ flex: 1, height: 44, padding: "0 16px", borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 13.5, outline: "none" }}
              />
              <button type="submit" disabled={typing || !chatInput.trim()} style={{ height: 44, padding: "0 22px", borderRadius: 10, border: "none", background: C.gradientTeal, color: "#fff", cursor: typing || !chatInput.trim() ? "not-allowed" : "pointer", fontWeight: 700, display: "flex", alignItems: "center", gap: 6, boxShadow: C.glowTeal }}>
                <Send size={15} /> Send
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
