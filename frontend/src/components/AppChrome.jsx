import React from "react";
import { C, FONT_DISPLAY, FONT_BODY, FONT_MONO } from "../tokens";

export function AppChrome({ children }) {
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
        
        * {
          box-sizing: border-box;
        }
        
        html, body, #root {
          height: 100%;
          margin: 0;
          padding: 0;
          font-family: ${FONT_BODY};
          background-color: ${C.paper};
          color: ${C.textInk};
          -webkit-font-smoothing: antialiased;
        }
        
        ::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        
        ::-webkit-scrollbar-thumb {
          background: #D8D5CD;
          border-radius: 4px;
        }

        ::-webkit-scrollbar-track {
          background: transparent;
        }
        
        select:focus, input:focus, textarea:focus {
          border-color: ${C.cobalt} !important;
          outline: none;
        }
        
        input, select, textarea {
          background: #FFFFFF;
          color: ${C.textInk};
          border: 1px solid ${C.border};
          font-family: ${FONT_BODY};
        }

        @keyframes pulseBar {
          0%, 100% { height: 4px; opacity: 0.5; }
          50% { height: 16px; opacity: 1; }
        }
        
        @keyframes typingDot {
          0%, 80%, 100% { opacity: 0.3; transform: translateY(0); }
          40% { opacity: 1; transform: translateY(-3px); }
        }
      `}</style>
      {children}
    </>
  );
}
