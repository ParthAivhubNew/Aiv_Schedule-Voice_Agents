import React, { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Eye, EyeOff, AlertTriangle, ArrowLeft, Copy, Check } from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../tokens";
import { BrandMark } from "../hub/BrandMark";
import { adminApi, saveSession } from "./adminApi";

const inputStyle = {
  width: "100%",
  height: 44,
  borderRadius: 10,
  border: `1px solid ${C.border}`,
  background: "#F7F7F5",
  padding: "0 14px",
  fontFamily: FONT_BODY,
  fontSize: 14,
  color: C.textInk,
  outline: "none",
  boxSizing: "border-box",
  transition: "border-color .15s, background .15s, box-shadow .15s",
};

const labelStyle = {
  display: "block",
  fontFamily: FONT_BODY,
  fontSize: 12.5,
  fontWeight: 600,
  color: C.textInk,
  marginBottom: 6,
};

const btnPrimary = {
  width: "100%",
  height: 44,
  borderRadius: 10,
  border: "none",
  background: C.cobalt,
  color: "#ffffff",
  fontFamily: FONT_BODY,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  transition: "background .15s, transform .1s",
};

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
    QRCode.toDataURL(setup.otpauth, { margin: 1, width: 180 }).then(setQr, () => setQr(""));
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
      setError(err.message || "Invalid email or password.");
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
        background: C.paper,
        padding: 20,
        fontFamily: FONT_BODY,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 400,
          background: "#FFFFFF",
          borderRadius: 16,
          border: `1px solid ${C.border}`,
          padding: "36px 32px",
          boxShadow: "0 4px 24px rgba(0, 0, 0, 0.05)",
        }}
      >
        {/* Brand Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <BrandMark size={34} />
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.textInk }}>
                OutReach
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: C.cobalt,
                  background: C.cobaltSoft,
                  padding: "1px 6px",
                  borderRadius: 6,
                }}
              >
                Staff
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: C.slate, marginTop: 1 }}>
              Admin portal for the Aivhub team
            </div>
          </div>
        </div>

        <form onSubmit={submit}>
          {/* Step 1: Direct Email & Password */}
          {step === "password" && (
            <div>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle} htmlFor="staff-email">
                  Email
                </label>
                <input
                  id="staff-email"
                  type="email"
                  autoComplete="username"
                  required
                  autoFocus
                  placeholder="parth.barot@aivhub.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  style={inputStyle}
                  onFocus={(e) => {
                    e.target.style.borderColor = C.cobalt;
                    e.target.style.background = "#FFFFFF";
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = C.border;
                    e.target.style.background = "#F7F7F5";
                  }}
                />
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={labelStyle} htmlFor="staff-password">
                  Password
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    id="staff-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    placeholder="Enter password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    style={{ ...inputStyle, paddingRight: 40 }}
                    onFocus={(e) => {
                      e.target.style.borderColor = C.cobalt;
                      e.target.style.background = "#FFFFFF";
                    }}
                    onBlur={(e) => {
                      e.target.style.borderColor = C.border;
                      e.target.style.background = "#F7F7F5";
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
                      color: C.slate,
                      cursor: "pointer",
                      padding: 4,
                      display: "flex",
                    }}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: 2FA Setup (First Login) */}
          {step === "setup" && setup && (
            <div>
              <div style={{ fontSize: 13, color: C.textInk, lineHeight: 1.5, marginBottom: 16 }}>
                Scan this with Google Authenticator or 1Password, then enter the 6-digit code.
              </div>

              {qr && (
                <div
                  style={{
                    background: "#FFFFFF",
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: 12,
                    display: "flex",
                    justifyContent: "center",
                    marginBottom: 12,
                  }}
                >
                  <img src={qr} alt="2FA QR Code" width={160} height={160} style={{ display: "block" }} />
                </div>
              )}

              <div
                style={{
                  background: "#F7F7F5",
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  padding: "6px 10px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 16,
                  fontSize: 11.5,
                }}
              >
                <span style={{ color: C.slate, overflow: "hidden", textOverflow: "ellipsis", marginRight: 8 }}>
                  Key: <strong style={{ fontFamily: FONT_MONO, color: C.textInk }}>{setup.secret}</strong>
                </span>
                <button
                  type="button"
                  onClick={copySecret}
                  style={{
                    background: copied ? C.green : C.paperSoft,
                    border: `1px solid ${C.border}`,
                    borderRadius: 6,
                    padding: "3px 8px",
                    color: copied ? "#FFFFFF" : C.textInk,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    flexShrink: 0,
                  }}
                >
                  {copied ? <Check size={11} /> : <Copy size={11} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>

              <div style={{ marginBottom: 18 }}>
                <label style={labelStyle} htmlFor="staff-code">
                  6-digit code
                </label>
                <input
                  id="staff-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9 ]{6,7}"
                  required
                  autoFocus
                  placeholder="000000"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  style={{
                    ...inputStyle,
                    fontFamily: FONT_MONO,
                    fontSize: 18,
                    letterSpacing: 4,
                    textAlign: "center",
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = C.cobalt;
                    e.target.style.background = "#FFFFFF";
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = C.border;
                    e.target.style.background = "#F7F7F5";
                  }}
                />
              </div>
            </div>
          )}

          {/* Step 3: Returning 2FA Challenge */}
          {step === "code" && (
            <div>
              <div style={{ fontSize: 13, color: C.slate, marginBottom: 16 }}>
                Enter the 6-digit code from your authenticator app.
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={labelStyle} htmlFor="staff-code">
                  6-digit code
                </label>
                <input
                  id="staff-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9 ]{6,7}"
                  required
                  autoFocus
                  placeholder="000000"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  style={{
                    ...inputStyle,
                    fontFamily: FONT_MONO,
                    fontSize: 18,
                    letterSpacing: 4,
                    textAlign: "center",
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = C.cobalt;
                    e.target.style.background = "#FFFFFF";
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = C.border;
                    e.target.style.background = "#F7F7F5";
                  }}
                />
              </div>
            </div>
          )}

          {/* Error Notice */}
          {error && (
            <div
              role="alert"
              style={{
                fontFamily: FONT_BODY,
                fontSize: 12.5,
                color: C.red,
                background: C.redSoft,
                border: `1px solid #F0C4B8`,
                borderRadius: 10,
                padding: "9px 12px",
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                marginBottom: 16,
              }}
            >
              <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>{error}</div>
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: "flex", gap: 8 }}>
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
                  height: 44,
                  borderRadius: 10,
                  border: `1px solid ${C.border}`,
                  background: "#FFFFFF",
                  color: C.textInk,
                  fontFamily: FONT_BODY,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  padding: "0 14px",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <ArrowLeft size={14} /> Back
              </button>
            )}

            <button
              type="submit"
              disabled={busy}
              style={{
                ...btnPrimary,
                opacity: busy ? 0.7 : 1,
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              {busy
                ? "Checking..."
                : step === "password"
                ? "Continue"
                : step === "setup"
                ? "Turn on two-factor and sign in"
                : "Sign in"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
