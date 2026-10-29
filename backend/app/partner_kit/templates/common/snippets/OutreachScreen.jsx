"use client";
// For React and Next.js. First paste the script line from panel.html into your index.html (or your Next.js layout).
// Then use this component anywhere:  <OutreachScreen component="leads" />   (leads, campaigns, mail, voice or social)
export default function OutreachScreen({ component = "leads", height = "700px" }) {
  return <div key={component} data-outreach={component} data-height={height} />;
}
