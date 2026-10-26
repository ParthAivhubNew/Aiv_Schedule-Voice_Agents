import React from "react";
import ReactDOM from "react-dom/client";
import { Tooltips } from "../components/Tooltips";
import "../app/global.css";
import { EmbedApp } from "./EmbedApp";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <EmbedApp />
    <Tooltips />
  </React.StrictMode>
);
