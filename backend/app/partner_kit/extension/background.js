// Clicking the Outreach button opens the side panel and, in the same click, reads a few facts about the page you are on
// (its address, title, site name, main heading and any text you selected). Chrome allows that for this click and this page only:
// the extension has no standing access to any site. Nothing is read until you click, and nothing leaves your browser from here.
function readPage() {
  const meta = (n) => (document.querySelector(`meta[property="${n}"],meta[name="${n}"]`) || {}).content || "";
  const clip = (v, n) => String(v || "").replace(/\s+/g, " ").trim().slice(0, n);
  return {
    url: location.href.split("#")[0], title: clip(document.title, 200), site: clip(meta("og:site_name"), 120),
    heading: clip((document.querySelector("h1") || {}).innerText, 200), selection: clip(String(getSelection() || ""), 300),
  };
}

chrome.action.onClicked.addListener(async (tab) => {
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
  let page = null;
  try {
    const [out] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readPage });
    page = out && out.result ? out.result : null;
  } catch (e) { /* a page the browser keeps private (settings, the web store): nothing to read */ }
  await chrome.storage.session.set({ page: page ? { ...page, at: Date.now() } : null });
});
