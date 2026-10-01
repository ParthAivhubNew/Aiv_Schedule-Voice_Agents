import React, { useEffect, useState } from "react";
import QRCode from "qrcode";
import {
  ShieldCheck,
  Lock,
  Mail,
  KeyRound,
  Copy,
  Check,
  Eye,
  EyeOff,
  ArrowRight,
  ArrowLeft,
  Shield,
  Fingerprint,
} from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../tokens";
import { adminApi, saveSession } from "./adminApi";

export function SignIn({ onSignedIn }) {
  const [form, setForm] = useState({ email: "", password: "", code: "" });
  const [step, setStep] = useState("password"); // password | code | setup
  const [setup, setSetup] = useState(null);
  const [qr, setQr] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!setup) return;
    QRCode.toDataURL(setup.otpauth, { margin: 1, width: 220 }).then(setQr, () => setQr(""));
  }, [setup]);

  const done = ({ token, staff }) => {
    saveSession(token, staff);
    onSignedIn(staff);
  };

  const copySecret = () => {
    if (!setup?.secret) return;
    navigator.clipboard.writeText(setup.secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (step === "setup") {
        done(await adminApi.confirm2fa(setup.ticket, form.code.trim()));
      } else {
        const r = await adminApi.login(
          form.email.trim(),
          form.password,
          step === "code" ? form.code.trim() : null
        );
        if (r.setup) {
          setSetup(r);
          setStep("setup");
        } else if (r.codeRequired) {
          setStep("code");
        } else {
          done(r);
        }
      }
    } catch (err) {
      setError(err.message || "Authentication failed");
    }
    setBusy(false);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#080d1a",
        backgroundImage: `
          radial-gradient(circle at 50% 20%, rgba(52, 87, 213, 0.18) 0%, transparent 60%),
          linear-gradient(to right, rgba(255, 255, 255, 0.02) 1px, transparent 1px),
          linear-gradient(to bottom, rgba(255, 255, 255, 0.02) 1px, transparent 1px)
        `,
        backgroundSize: "100% 100%, 32px 32px, 32px 32px",
        padding: "24px 16px",
        fontFamily: FONT_BODY,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Ambient background glow */}
      <div
        style={{
          position: "absolute",
          width: 500,
          height: 350,
          borderRadius: "50%",
          background: "linear-gradient(135deg, rgba(52, 87, 213, 0.15), rgba(12, 140, 125, 0.15))",
          filter: "blur(100px)",
          pointerEvents: "none",
          top: "20%",
        }}
      />

      <div
        style={{
          width: "100%",
          maxWidth: 440,
          background: "rgba(15, 23, 42, 0.85)",
          backdropFilter: "blur(20px)",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          borderRadius: 24,
          padding: "32px 28px",
          boxShadow: "0 25px 60px -15px rgba(0, 0, 0, 0.6), 0 0 35px rgba(52, 87, 213, 0.15)",
          position: "relative",
          zIndex: 10,
        }}
      >
        {/* Header Branding & Status */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "between",
            marginBottom: 24,
            paddingBottom: 16,
            borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                background: "rgba(52, 87, 213, 0.15)",
                border: "1px solid rgba(52, 87, 213, 0.3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#60a5fa",
              }}
            >
              <ShieldCheck size={22} />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    fontFamily: FONT_DISPLAY,
                    fontWeight: 700,
                    fontSize: 18,
                    color: "#ffffff",
                    letterSpacing: "-0.02em",
                  }}
                >
                  OutReach
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#93c5fd",
                    background: "rgba(59, 130, 246, 0.15)",
                    border: "1px solid rgba(59, 130, 246, 0.3)",
                    padding: "2px 7px",
                    borderRadius: 6,
                  }}
                >
                  Staff Portal
                </span>
              </div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
                Platform Operations & Security
              </div>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              borderRadius: 20,
              background: "rgba(16, 185, 129, 0.12)",
              border: "1px solid rgba(16, 185, 129, 0.25)",
              color: "#34d399",
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#34d399",
                boxShadow: "0 0 8px #34d399",
              }}
            />
            2FA Active
          </div>
        </div>

        <form onSubmit={submit}>
          {/* Step 1: Staff Email and Password */}
          {step === "password" && (
            <div>
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#ffffff", marginBottom: 4 }}>
                  Staff Authentication
                </div>
                <div style={{ fontSize: 12.5, color: "#94a3b8", lineHeight: 1.5 }}>
                  Access client tenants, AI provider keys, telephony routing, and real-time operations.
                </div>
              </div>

              {/* Email Input */}
              <div style={{ marginBottom: 16 }}>
                <label
                  style={{
                    display: "block",
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: "#cbd5e1",
                    marginBottom: 6,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                  htmlFor="staff-email"
                >
                  Staff Email
                </label>
                <div style={{ position: "relative" }}>
                  <Mail
                    size={16}
                    style={{
                      position: "absolute",
                      left: 14,
                      top: "50%",
                      transform: "translateY(-50%)",
                      color: "#64748b",
                    }}
                  />
                  <input
                    id="staff-email"
                    type="email"
                    autoComplete="username"
                    required
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="parth.barot@aivhub.com"
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      background: "rgba(15, 23, 42, 0.9)",
                      border: "1px solid rgba(100, 116, 139, 0.3)",
                      borderRadius: 12,
                      padding: "11px 14px 11px 40px",
                      color: "#ffffff",
                      fontSize: 14,
                      outline: "none",
                      transition: "border-color 0.2s, box-shadow 0.2s",
                    }}
                    onFocus={(e) => {
                      e.target.style.borderColor = "#3b82f6";
                      e.target.style.boxShadow = "0 0 0 3px rgba(59, 130, 246, 0.2)";
                    }}
                    onBlur={(e) => {
                      e.target.style.borderColor = "rgba(100, 116, 139, 0.3)";
                      e.target.style.boxShadow = "none";
                    }}
                  />
                </div>
              </div>

              {/* Password Input */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <label
                    style={{
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: "#cbd5e1",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                    htmlFor="staff-password"
                  >
                    Password
                  </label>
                  <span style={{ fontSize: 11, color: "#64748b" }}>Argon2id Protected</span>
                </div>
                <div style={{ position: "relative" }}>
                  <Lock
                    size={16}
                    style={{
                      position: "absolute",
                      left: 14,
                      top: "50%",
                      transform: "translateY(-50%)",
                      color: "#64748b",
                    }}
                  />
                  <input
                    id="staff-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder="••••••••••••••••"
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      background: "rgba(15, 23, 42, 0.9)",
                      border: "1px solid rgba(100, 116, 139, 0.3)",
                      borderRadius: 12,
                      padding: "11px 42px 11px 40px",
                      color: "#ffffff",
                      fontSize: 14,
                      outline: "none",
                      transition: "border-color 0.2s, box-shadow 0.2s",
                    }}
                    onFocus={(e) => {
                      e.target.style.borderColor = "#3b82f6";
                      e.target.style.boxShadow = "0 0 0 3px rgba(59, 130, 246, 0.2)";
                    }}
                    onBlur={(e) => {
                      e.target.style.borderColor = "rgba(100, 116, 139, 0.3)";
                      e.target.style.boxShadow = "none";
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      position: "absolute",
                      right: 12,
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "none",
                      border: "none",
                      color: "#64748b",
                      cursor: "pointer",
                      padding: 4,
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: 2FA QR Setup (First Login) */}
          {step === "setup" && setup && (
            <div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#ffffff", marginBottom: 4 }}>
                  Two-Factor Enrollment
                </div>
                <div style={{ fontSize: 12.5, color: "#94a3b8", lineHeight: 1.5 }}>
                  Scan this QR code with Google Authenticator, Microsoft Authenticator, or 1Password.
                </div>
              </div>

              {/* QR Container */}
              <div
                style={{
                  background: "#ffffff",
                  padding: 14,
                  borderRadius: 16,
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  marginBottom: 14,
                  boxShadow: "0 4px 20px rgba(0, 0, 0, 0.3)",
                }}
              >
                {qr ? (
                  <img
                    src={qr}
                    alt="2FA QR Code"
                    width={180}
                    height={180}
                    style={{ display: "block", borderRadius: 8 }}
                  />
                ) : (
                  <div style={{ height: 180, display: "flex", alignItems: "center", color: "#64748b" }}>
                    Generating QR code...
                  </div>
                )}
              </div>

              {/* Secret Key with Copy Button */}
              <div
                style={{
                  background: "rgba(15, 23, 42, 0.9)",
                  border: "1px solid rgba(100, 116, 139, 0.25)",
                  borderRadius: 12,
                  padding: "8px 12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 16,
                }}
              >
                <div style={{ overflow: "hidden", marginRight: 8 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
                    Manual Setup Key
                  </div>
                  <div
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 11.5,
                      color: "#93c5fd",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      userSelect: "all",
                    }}
                  >
                    {setup.secret}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={copySecret}
                  style={{
                    background: copied ? "#059669" : "rgba(30, 41, 59, 0.9)",
                    border: "1px solid rgba(100, 116, 139, 0.3)",
                    borderRadius: 8,
                    padding: "6px 10px",
                    color: copied ? "#ffffff" : "#cbd5e1",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    transition: "all 0.2s",
                    flexShrink: 0,
                  }}
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>

              {/* 6-Digit Code Input */}
              <div style={{ marginBottom: 16 }}>
                <label
                  style={{
                    display: "block",
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: "#cbd5e1",
                    marginBottom: 6,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                  htmlFor="staff-code"
                >
                  6-Digit Verification Code
                </label>
                <input
                  id="staff-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9 ]{6,7}"
                  required
                  autoFocus
                  placeholder="000 000"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    background: "rgba(15, 23, 42, 0.9)",
                    border: "1px solid rgba(100, 116, 139, 0.3)",
                    borderRadius: 12,
                    padding: "10px 14px",
                    color: "#ffffff",
                    fontFamily: FONT_MONO,
                    fontSize: 20,
                    letterSpacing: "0.3em",
                    textAlign: "center",
                    outline: "none",
                  }}
                />
              </div>
            </div>
          )}

          {/* Step 3: Returning 2FA Challenge */}
          {step === "code" && (
            <div>
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#ffffff", marginBottom: 4 }}>
                  Two-Factor Challenge
                </div>
                <div style={{ fontSize: 12.5, color: "#94a3b8", lineHeight: 1.5 }}>
                  Enter the 6-digit security code generated by your authenticator app.
                </div>
              </div>

              <div style={{ marginBottom: 20 }}>
                <label
                  style={{
                    display: "block",
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: "#cbd5e1",
                    marginBottom: 8,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    textAlign: "center",
                  }}
                  htmlFor="staff-code"
                >
                  6-Digit Authenticator Token
                </label>
                <input
                  id="staff-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9 ]{6,7}"
                  required
                  autoFocus
                  placeholder="000 000"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    background: "rgba(15, 23, 42, 0.9)",
                    border: "1px solid rgba(100, 116, 139, 0.3)",
                    borderRadius: 14,
                    padding: "14px",
                    color: "#ffffff",
                    fontFamily: FONT_MONO,
                    fontSize: 22,
                    fontWeight: 700,
                    letterSpacing: "0.35em",
                    textAlign: "center",
                    outline: "none",
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = "#3b82f6";
                    e.target.style.boxShadow = "0 0 0 3px rgba(59, 130, 246, 0.25)";
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = "rgba(100, 116, 139, 0.3)";
                    e.target.style.boxShadow = "none";
                  }}
                />
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div
              role="alert"
              style={{
                color: "#f87171",
                background: "rgba(239, 68, 68, 0.12)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                borderRadius: 10,
                padding: "8px 12px",
                fontSize: 12.5,
                marginBottom: 16,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span style={{ fontSize: 14 }}>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            {step !== "password" && (
              <button
                type="button"
                onClick={() => {
                  setStep("password");
                  setSetup(null);
                  setForm({ ...form, code: "" });
                  setError("");
                }}
                style={{
                  width: "35%",
                  background: "rgba(30, 41, 59, 0.8)",
                  border: "1px solid rgba(100, 116, 139, 0.3)",
                  borderRadius: 12,
                  padding: "12px",
                  color: "#cbd5e1",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  transition: "all 0.2s",
                }}
              >
                <ArrowLeft size={14} /> Back
              </button>
            )}

            <button
              type="submit"
              disabled={busy}
              style={{
                flex: 1,
                background: "linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)",
                border: "none",
                borderRadius: 12,
                padding: "12px 18px",
                color: "#ffffff",
                fontSize: 13.5,
                fontWeight: 600,
                cursor: busy ? "not-allowed" : "pointer",
                opacity: busy ? 0.7 : 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                boxShadow: "0 4px 14px rgba(59, 130, 246, 0.35)",
                transition: "all 0.2s",
              }}
            >
              {step === "password" ? (
                <>
                  <span>Continue</span>
                  <ArrowRight size={15} />
                </>
              ) : step === "setup" ? (
                <>
                  <KeyRound size={15} />
                  <span>Activate 2FA & Enter</span>
                </>
              ) : (
                <>
                  <Fingerprint size={15} />
                  <span>Verify & Sign In</span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* Security Badges Footer */}
        <div
          style={{
            marginTop: 24,
            paddingTop: 16,
            borderTop: "1px solid rgba(255, 255, 255, 0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 11,
            color: "#64748b",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <Shield size={12} color="#60a5fa" /> Isolated Session
          </span>
          <span>TLS 1.3 Encrypted</span>
          <span>Zero Client Access</span>
        </div>
      </div>
    </div>
  );
}
