import { useEffect, useRef } from "react";

// Esc closes only the top-most open window. Layers register a depth (approvals or the
// schedule window 1 < post preview 2 < enlarged image 3) because child effects run before
// parent effects, so registration order alone would put the outer window on top.
const escLayers = [];
function onEscapeKey(e) {
  // A field that used Esc itself (e.g. to cancel typing) marks the event handled.
  if (e.key !== "Escape" || !escLayers.length || e.defaultPrevented) return;
  const top = escLayers.reduce((a, b) => (b.depth >= a.depth ? b : a));
  e.preventDefault();
  e.stopPropagation();
  top.close.current();
}

export function useEscapeLayer(active, depth, onClose) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!active) return undefined;
    const layer = { depth, close };
    if (!escLayers.length) window.addEventListener("keydown", onEscapeKey);
    escLayers.push(layer);
    return () => {
      const i = escLayers.indexOf(layer);
      if (i >= 0) escLayers.splice(i, 1);
      if (!escLayers.length) window.removeEventListener("keydown", onEscapeKey);
    };
  }, [active, depth]);
}
