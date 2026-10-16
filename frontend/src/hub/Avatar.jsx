import { useState } from "react";
import { C, FONT_BODY, initialsFromName } from "../tokens";

// A person's photo, or their initials when they have none. `user` is an operator object.
export function Avatar({ user, size = 32, bg }) {
  const [broken, setBroken] = useState(null);
  const src = user?.avatar_url;
  const circle = { width: size, height: size, borderRadius: 999, flexShrink: 0 };
  if (src && broken !== src) {
    return <img src={src} alt="" onError={() => setBroken(src)} style={{ ...circle, objectFit: "cover", display: "block" }} />;
  }
  return (
    <div aria-hidden="true" style={{ ...circle, background: bg || (user?.is_admin ? C.cobalt : C.slate), color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_BODY, fontSize: Math.max(10, Math.round(size * 0.38)), fontWeight: 700 }}>
      {initialsFromName(user?.name)}
    </div>
  );
}
