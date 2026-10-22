import React from "react";
import ReactDOM from "react-dom/client";
import { AdminApp } from "./AdminApp";
import { Tooltips } from "../components/Tooltips";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AdminApp />
    <Tooltips />
  </React.StrictMode>,
);
