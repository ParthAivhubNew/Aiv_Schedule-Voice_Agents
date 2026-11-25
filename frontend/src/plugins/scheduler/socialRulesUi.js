// What the company's Social rules leave on the screens (plan 12, F2). The server refuses the same things (services/social_rules.py);
// these only keep the screens from offering them. `social` is the brand context's copy of GET /org/policy's "social".

export const RULE_NOTES = {
  images: "Your company's rules don't allow AI pictures. Upload your own picture instead.",
  video: "Your company's rules don't allow AI video.",
  networks: "Your company's rules limit which networks you post to.",
};

// The channels the rules allow, in the screen's order. Nothing is filtered when there are no Social rules.
export function allowedChannels(channels, social) {
  if (!social) return channels;
  if (social.networks_none) return [];
  const nets = Array.isArray(social.networks) ? social.networks : [];
  return nets.length ? channels.filter((c) => nets.includes(c.id)) : channels;
}

export const aiImagesOff = (social) => Boolean(social && social.ai_images === false);
export const aiVideoOff = (social) => Boolean(social && social.ai_video === false);
export const networksLimited = (social) => Boolean(social && (social.networks_none || (social.networks || []).length));
