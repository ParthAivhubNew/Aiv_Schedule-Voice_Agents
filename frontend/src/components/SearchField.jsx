import React from "react";
import { Search, X } from "lucide-react";

// A search box that fills the row it sits in and shrinks with the window. The search icon and the clear button are centred inside the
// white box (not placed by fixed pixels), so they stay inside it at any size, and the text never runs under the clear button.
export function SearchField({ value, onChange, placeholder, label, title, height = 44, style, className = "" }) {
  return (
    <label className={`search-field ${className}`} title={title} style={{ height, ...style }}>
      <Search size={16} aria-hidden="true" className="search-field-icon" />
      <input className="search-field-input" type="text" aria-label={label || placeholder} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} />
      {value ? <button type="button" className="search-field-clear" aria-label="Clear the search" title="Clear" onClick={() => onChange("")}><X size={14} aria-hidden="true" /></button> : null}
    </label>
  );
}
