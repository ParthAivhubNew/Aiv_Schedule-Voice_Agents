import React from "react";
import { BarChart3, TrendingUp, CalendarCheck, PhoneCall, DollarSign } from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../tokens";
import { TopBar } from "../components/TopBar";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
} from "recharts";

export function AnalyticsView({ notifications, setNotifications, analyticsData = {} }) {
  const metrics = analyticsData.metrics || {
    conversionRate: "18%",
    conversionDelta: "+2.4% vs last week",
    meetingsBooked: 10,
    meetingsDelta: "+3 today",
    activeMissions: 4,
    prospectsReached: 41,
  };

  const trend = analyticsData.trend || [
    { day: "1 Aug", rate: 11 },
    { day: "6 Aug", rate: 12 },
    { day: "11 Aug", rate: 13 },
    { day: "16 Aug", rate: 15 },
    { day: "21 Aug", rate: 16 },
    { day: "26 Aug", rate: 18 },
  ];

  const costBreakdown = analyticsData.costBreakdown || [
    { name: "LLM", Paid: 320, "Open Source": 42 },
    { name: "STT", Paid: 180, "Open Source": 6 },
    { name: "TTS", Paid: 260, "Open Source": 4 },
    { name: "Telephony", Paid: 410, "Open Source": 380 },
  ];

  return (
    <div style={{ flex: 1, overflowY: "auto", background: C.bg }}>
      <TopBar
        title="Analytics & Unit Economics"
        subtitle="Live conversion tracking, booking velocity, and infrastructure cost benchmarks."
        notifications={notifications}
        setNotifications={setNotifications}
      />

      <div style={{ padding: 32 }}>
        {/* Metric Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 18, marginBottom: 32 }}>
          <div style={{ background: "rgba(18, 22, 41, 0.75)", backdropFilter: "blur(16px)", borderRadius: 18, border: `1px solid ${C.border}`, padding: 22, boxShadow: C.shadowCard }}>
            <div style={{ fontSize: 12, color: C.slate, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Conversion Rate</div>
            <div style={{ fontFamily: FONT_MONO, fontSize: 28, fontWeight: 700, color: C.teal, marginTop: 8 }}>{metrics.conversionRate}</div>
            <div style={{ fontSize: 12, color: C.teal, marginTop: 4 }}>{metrics.conversionDelta}</div>
          </div>
          <div style={{ background: "rgba(18, 22, 41, 0.75)", backdropFilter: "blur(16px)", borderRadius: 18, border: `1px solid ${C.border}`, padding: 22, boxShadow: C.shadowCard }}>
            <div style={{ fontSize: 12, color: C.slate, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Meetings Booked</div>
            <div style={{ fontFamily: FONT_MONO, fontSize: 28, fontWeight: 700, color: C.cobaltDeep, marginTop: 8 }}>{metrics.meetingsBooked}</div>
            <div style={{ fontSize: 12, color: C.slate, marginTop: 4 }}>{metrics.meetingsDelta}</div>
          </div>
          <div style={{ background: "rgba(18, 22, 41, 0.75)", backdropFilter: "blur(16px)", borderRadius: 18, border: `1px solid ${C.border}`, padding: 22, boxShadow: C.shadowCard }}>
            <div style={{ fontSize: 12, color: C.slate, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Prospects Contacted</div>
            <div style={{ fontFamily: FONT_MONO, fontSize: 28, fontWeight: 700, color: "#FFFFFF", marginTop: 8 }}>{metrics.prospectsReached}</div>
            <div style={{ fontSize: 12, color: C.slate, marginTop: 4 }}>Across {metrics.activeMissions} missions</div>
          </div>
        </div>

        {/* Charts */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          {/* Conversion Rate Trend */}
          <div style={{ background: "rgba(18, 22, 41, 0.75)", backdropFilter: "blur(16px)", borderRadius: 20, border: `1px solid ${C.border}`, padding: 26, boxShadow: C.shadowCard }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: "#FFFFFF", marginBottom: 18 }}>
              Booking Conversion Trend (%)
            </div>
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="day" stroke={C.slate} fontSize={11.5} />
                  <YAxis stroke={C.slate} fontSize={11.5} />
                  <Tooltip contentStyle={{ background: "#121629", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, color: "#fff" }} />
                  <Line type="monotone" dataKey="rate" stroke="#9353FF" strokeWidth={3} dot={{ r: 5, fill: "#9353FF" }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Cost Comparison */}
          <div style={{ background: "rgba(18, 22, 41, 0.75)", backdropFilter: "blur(16px)", borderRadius: 20, border: `1px solid ${C.border}`, padding: 26, boxShadow: C.shadowCard }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: "#FFFFFF", marginBottom: 18 }}>
              Cost per 10k Calls ($) — Paid vs Open Source
            </div>
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={costBreakdown}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="name" stroke={C.slate} fontSize={11.5} />
                  <YAxis stroke={C.slate} fontSize={11.5} />
                  <Tooltip contentStyle={{ background: "#121629", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, color: "#fff" }} />
                  <Legend />
                  <Bar dataKey="Paid" fill="#4B73FF" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="Open Source" fill="#00E5C3" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
