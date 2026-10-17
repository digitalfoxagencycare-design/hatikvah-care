/** Remembers where a visitor came from (ad campaign, Google, referral) for this browser session, and loads analytics when IDs are set. */
const KEY = "hc_source";
export function captureSource() {
  try {
    if (sessionStorage.getItem(KEY)) return;
    const q = new URLSearchParams(location.search), s = {};
    for (const k of ["utm_source", "utm_medium", "utm_campaign"]) if (q.get(k)) s[k] = q.get(k).slice(0, 100);
    if (q.get("gclid") && !s.utm_source) { s.utm_source = "google-ads"; s.utm_medium = "cpc"; }
    if (q.get("fbclid") && !s.utm_source) { s.utm_source = "facebook"; s.utm_medium = "social"; }
    if (document.referrer && !document.referrer.startsWith(location.origin)) s.referrer = document.referrer.slice(0, 200);
    s.page = location.pathname.slice(0, 200);
    sessionStorage.setItem(KEY, JSON.stringify(s));
  } catch { /* storage blocked */ }
}
export const getSource = () => { try { return JSON.parse(sessionStorage.getItem(KEY)) || undefined; } catch { return undefined; } };

let loaded = false;
export function loadAnalytics({ ga4Id, metaPixelId }) {
  if (loaded || (!ga4Id && !metaPixelId)) return; loaded = true;
  const add = (src) => { const s = document.createElement("script"); s.async = true; s.src = src; document.head.appendChild(s); };
  if (ga4Id) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() { window.dataLayer.push(arguments); }; // eslint-disable-line prefer-rest-params
    window.gtag("js", new Date()); window.gtag("config", ga4Id);
    add(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4Id)}`);
  }
  if (metaPixelId) {
    const f = (window.fbq = function fbq() { f.callMethod ? f.callMethod.apply(f, arguments) : f.queue.push(arguments); }); // eslint-disable-line prefer-rest-params
    f.push = f; f.loaded = true; f.version = "2.0"; f.queue = []; if (!window._fbq) window._fbq = f;
    window.fbq("init", metaPixelId); window.fbq("track", "PageView");
    add("https://connect.facebook.net/en_US/fbevents.js");
  }
}
/** Conversion event when an enquiry is sent (shows up as a "generate_lead" / "Lead" in GA4 and Meta). */
export function trackLead() {
  try { window.gtag?.("event", "generate_lead"); window.fbq?.("track", "Lead"); } catch { /* ignore */ }
}
