import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("[RootErrorBoundary] Uncaught Application Error:", error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReset = () => {
    try {
      sessionStorage.clear();
      localStorage.removeItem("aivhub_active_plugin");
    } catch (_) {}
    window.location.href = window.location.origin + window.location.pathname;
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0f172a",
          color: "#f8fafc",
          fontFamily: "Inter, system-ui, sans-serif",
          padding: 24,
        }}>
          <div style={{
            maxWidth: 580,
            width: "100%",
            background: "#1e293b",
            borderRadius: 16,
            border: "1px solid #334155",
            padding: "32px 28px",
            boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: "rgba(239, 68, 68, 0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>
                ⚠️
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#f1f5f9" }}>Application UI Recovery</h2>
                <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>Outreach by Aivhub</div>
              </div>
            </div>
            
            <p style={{ fontSize: 13.5, color: "#cbd5e1", lineHeight: 1.55, margin: "0 0 16px" }}>
              A rendering issue was detected after login:
            </p>
            
            <div style={{
              background: "#090d16",
              borderRadius: 8,
              border: "1px solid #1e293b",
              padding: 12,
              fontFamily: "monospace",
              fontSize: 12,
              color: "#f87171",
              overflowX: "auto",
              marginBottom: 20,
              maxHeight: 140,
            }}>
              {this.state.error?.message || "Unknown error occurred during rendering."}
            </div>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{
                  padding: "10px 18px",
                  borderRadius: 8,
                  background: "#3b82f6",
                  color: "#fff",
                  border: "none",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Reload Page
              </button>
              <button
                type="button"
                onClick={this.handleReset}
                style={{
                  padding: "10px 18px",
                  borderRadius: 8,
                  background: "#334155",
                  color: "#e2e8f0",
                  border: "none",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Reset Session & Return to Hub
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>
);
