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
async function searchProvider(query) {
  if (process.env.SEARXNG_URL) {
    const u = new URL("/search", process.env.SEARXNG_URL);
    u.searchParams.set("q", query); u.searchParams.set("format", "json");
    const raw = await fetch(u, { headers: { Accept: "application/json", "User-Agent": UA }, signal: AbortSignal.timeout(12000) });
    if (!raw.ok) throw new Error("SearXNG search provider returned HTTP " + raw.status);
    const body = await raw.json();
    return (body.results || []).slice(0, 5).map(x => ({ url: x.url, title: x.title || "", description: x.content || "" }));
  }
  if (process.env.TAVILY_API_KEY) {
    const raw = await fetch("https://api.tavily.com/search", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query, search_depth: "basic", max_results: 5 }),
      signal: AbortSignal.timeout(12000)
    });
    if (!raw.ok) throw new Error("Tavily returned HTTP " + raw.status);
    const body = await raw.json();
    return (body.results || []).slice(0, 5).map(x => ({ url: x.url, title: x.title || "", description: x.content || "" }));
  }
  throw new Error("Configure SEARXNG_URL or TAVILY_API_KEY in Vercel environment variables.");
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
    const items = await searchProvider(query.trim());
    for (const item of items) {
      const u = await safeUrl(item.url);
      if (!u) continue;
      const resultText = [item.title, item.description, item.url].filter(Boolean).join(" ");
      for (const email of emails(resultText)) {
        found.set(city.toLowerCase() + "|" + email, { city, email, sourceUrl: u.href, domain: u.hostname, sourceType: "search-result", template, createdAt: new Date().toISOString() });
      }
    }
    return res.status(200).json({ ok: true, provider: process.env.SEARXNG_URL ? "SearXNG" : "Tavily", count: found.size, results: [...found.values()] });
  } catch (e) {
    return res.status(502).json({ error: e.message || "Search failed" });
  }
}
