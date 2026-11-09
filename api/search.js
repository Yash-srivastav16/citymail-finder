import dns from "node:dns/promises";
import net from "node:net";

const UA = "CityMailFinder/1.0 (+public business contact discovery; respects robots.txt)";
const emailRx = /[A-Z0-9.!#$%&'*+/=?^`_{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/gi;

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a,b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    return x === "::" || x === "::1" || x.startsWith("fc") ||
      x.startsWith("fd") || x.startsWith("fe80:") || x.startsWith("::ffff:127.") ||
      x.startsWith("::ffff:10.") || x.startsWith("::ffff:192.168.");
  }
  return true;
}
async function safeUrl(raw) {
  try {
    const u = new URL(raw);
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) return null;
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return null;
    if (net.isIP(host)) return privateIp(host) ? null : u;
    const records = await dns.lookup(host, { all: true, verbatim: true });
    if (!records.length || records.some(r => privateIp(r.address))) return null;
    return u;
  } catch { return null; }
}
function emails(s) {
  return [...new Set((String(s).match(emailRx) || []).map(x => x.replace(/[),.;:]+$/, "").toLowerCase()))]
    .filter(x => x.length < 255 && !/\.(png|jpe?g|gif|svg|webp|css|js)$/i.test(x) && !/^(example|test)@/i.test(x));
}
function retryAfterMs(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

async function searchProvider(query, city = "") {
  const providers = [];
  if (process.env.FREESEA_API_KEY) providers.push({ name: "Freesea", run: async () => {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const startedAt = Date.now();
      const raw = await fetch("https://freesea.dev/v1/search", {
        method: "POST",
        headers: { "Authorization": "Bearer " + process.env.FREESEA_API_KEY, "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ query }), signal: AbortSignal.timeout(15000)
      });
      if (raw.ok) {
        const body = await raw.json();
        console.info("[citymail] provider_response", JSON.stringify({ provider: "Freesea", city, status: raw.status, attempt: attempt + 1, durationMs: Date.now() - startedAt }));
        return (body.results || []).filter(x => x && x.type !== "sponsored").slice(0, 10).map(x => ({ url: x.url || x.link || "", title: x.title || "", description: x.snippet || x.description || x.content || "" }));
      }
      const responseText = (await raw.text()).slice(0, 800);
      const retryHeader = raw.headers.get("retry-after");
      const waitMs = retryAfterMs(retryHeader);
      lastError = new Error("Freesea HTTP " + raw.status + (retryHeader ? "; Retry-After: " + retryHeader : "") + (responseText ? "; " + responseText : ""));
      console.warn("[citymail] provider_error", JSON.stringify({ provider: "Freesea", city, status: raw.status, attempt: attempt + 1, durationMs: Date.now() - startedAt, retryAfter: retryHeader, responseBody: responseText }));
      if (raw.status === 429 && attempt === 0 && waitMs !== null && waitMs <= 2000) { await new Promise(resolve => setTimeout(resolve, waitMs)); continue; }
      throw lastError;
    }
    throw lastError || new Error("Freesea request failed");
  }});
  if (process.env.SEARXNG_URL) providers.push({ name: "SearXNG", run: async () => {
    const u = new URL("/search", process.env.SEARXNG_URL); u.searchParams.set("q", query); u.searchParams.set("format", "json");
    const raw = await fetch(u, { headers: { Accept: "application/json", "User-Agent": UA }, signal: AbortSignal.timeout(12000) });
    if (!raw.ok) throw new Error("SearXNG HTTP " + raw.status);
    const body = await raw.json();
    return (body.results || []).slice(0, 10).map(x => ({ url: x.url || "", title: x.title || "", description: x.content || "" }));
  }});
  if (process.env.TAVILY_API_KEY) providers.push({ name: "Tavily", run: async () => {
    const raw = await fetch("https://api.tavily.com/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query, search_depth: "basic", max_results: 10 }), signal: AbortSignal.timeout(12000) });
    if (!raw.ok) throw new Error("Tavily HTTP " + raw.status);
    const body = await raw.json();
    return (body.results || []).slice(0, 10).map(x => ({ url: x.url || "", title: x.title || "", description: x.content || "" }));
  }});
  if (!providers.length) throw new Error("Configure FREESEA_API_KEY, SEARXNG_URL or TAVILY_API_KEY in Vercel environment variables.");
  const failures = [];
  for (const provider of providers) {
    try {
      const items = await provider.run();
      console.info("[citymail] provider_selected", JSON.stringify({ city, provider: provider.name, resultCount: items.length }));
      return { provider: provider.name, items };
    } catch (error) {
      failures.push(provider.name + ": " + (error.message || "request failed"));
      console.warn("[citymail] provider_fallback", JSON.stringify({ city, failedProvider: provider.name, message: error.message || "request failed" }));
    }
  }
  throw new Error("All search providers failed. " + failures.join(" | "));
}
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Citymail-Token");
  const origin = req.headers.origin || "";
  if (origin.startsWith("chrome-extension://") || origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) res.setHeader("Access-Control-Allow-Origin", origin);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const token = process.env.CITYMAIL_ACCESS_TOKEN;
  if (token && req.headers["x-citymail-token"] !== token) return res.status(401).json({ error: "Unauthorized" });
  const { city, query, template = "default" } = req.body || {};
  if (typeof city !== "string" || !city.trim() || typeof query !== "string" || query.length > 400 || !query.trim()) return res.status(400).json({ error: "Provide a city and a search query (maximum 400 characters)." });
  try {
    const found = new Map();
    console.info("[citymail] search_started", JSON.stringify({ city, template, provider: process.env.FREESEA_API_KEY ? "Freesea" : process.env.SEARXNG_URL ? "SearXNG" : process.env.TAVILY_API_KEY ? "Tavily" : "none" }));
    const searched = await searchProvider(query.trim(), city);\n    const items = searched.items;
    for (const item of items) {
      const u = await safeUrl(item.url);
      if (!u) continue;
      const resultText = [item.title, item.description, item.url].filter(Boolean).join(" ");
      for (const email of emails(resultText)) {
        found.set(city.toLowerCase() + "|" + email, { city, email, sourceUrl: u.href, domain: u.hostname, sourceType: "search-result", template, createdAt: new Date().toISOString() });
      }
    }
    return res.status(200).json({ ok: true, provider: searched.provider, count: found.size, results: [...found.values()] });
  } catch (e) {
    const message = e.message || "Search failed";
    const captcha = /captcha|human verification|verify you are human|challenge/i.test(message);
    const rateLimited = /http 429|rate.?limit|too many requests/i.test(message);
    console.error("[citymail] search_failed", JSON.stringify({ city, template, code: captcha ? "CAPTCHA_REQUIRED" : rateLimited ? "RATE_LIMITED" : "SEARCH_FAILED", message }));
    if (captcha) return res.status(429).json({ code: "CAPTCHA_REQUIRED", error: "Provider requires manual CAPTCHA / human verification. Pause the queue, open the provider page manually, complete verification, then resume." });
    if (rateLimited) return res.status(429).json({ code: "RATE_LIMITED", error: "Search provider rate limit reached. Pause the queue and wait before resuming." });
    return res.status(502).json({ code: "SEARCH_FAILED", error: message });
  }
}
