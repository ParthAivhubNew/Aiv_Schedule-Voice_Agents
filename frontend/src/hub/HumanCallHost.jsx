import React, { Suspense, lazy, useEffect, useState } from "react";
import { usePluginAccess } from "../components/PluginAccessGate";
import { onPhoneRequest } from "../utils/humanCall";

// The browser phone, mounted once for the whole app so a call keeps going while the person moves between screens.
// Any screen opens it with openPhone() / openTranscript() from utils/humanCall.js.
const HumanCallPanel = lazy(() => import("../plugins/voice/calling/HumanCallPanel"));

export default function HumanCallHost() {
  const { hasPlan } = usePluginAccess("voice"); // the phone belongs to the Voice plugin
  const [request, setRequest] = useState(null);
  const [n, setN] = useState(0);
  useEffect(() => onPhoneRequest((detail) => { if (hasPlan) { setRequest(detail); setN((x) => x + 1); } }), [hasPlan]);
  if (!request) return null;
  return (
    <Suspense fallback={null}>
      <HumanCallPanel key={n} request={request} onClose={() => setRequest(null)} />
    </Suspense>
  );
}
