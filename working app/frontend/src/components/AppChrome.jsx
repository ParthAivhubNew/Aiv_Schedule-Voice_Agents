import React from "react";

export function AppChrome() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap');
      
      * {
        box-sizing: border-box;
      }
      
      body, html {
        margin: 0;
        padding: 0;
        background-color: #090B13;
        color: #F8FAFC;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        overflow-x: hidden;
      }

      ::selection {
        background: rgba(147, 83, 255, 0.35);
        color: #FFFFFF;
      }

      ::-webkit-scrollbar {
        width: 6px;
        height: 6px;
      }
      ::-webkit-scrollbar-track {
        background: rgba(9, 11, 19, 0.8);
      }
      ::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.14);
        border-radius: 999px;
      }
      ::-webkit-scrollbar-thumb:hover {
        background: rgba(147, 83, 255, 0.4);
      }

      input, textarea, select {
        background: #111424 !important;
        color: #F8FAFC !important;
        border: 1px solid rgba(255, 255, 255, 0.12) !important;
        outline: none;
        transition: border-color 0.15s, box-shadow 0.15s;
      }
      input:focus, textarea:focus, select:focus {
        border-color: #9353FF !important;
        box-shadow: 0 0 0 3px rgba(147, 83, 255, 0.25) !important;
      }
      input::placeholder, textarea::placeholder {
        color: #64748B !important;
      }

      @keyframes pulseBar {
        0%, 100% { height: 4px; opacity: 0.4; }
        50% { height: 14px; opacity: 1; }
      }
    `}</style>
  );
}
