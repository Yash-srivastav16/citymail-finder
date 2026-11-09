import dns from "node:dns/promises";
import net from "node:net";
import * as cheerio from "cheerio";
import robotsParser from "robots-parser";

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
async function fetchText(url, accept = "text/html,application/xhtml+xml") {
  const safe = await safeUrl(url);
  if (!safe) return null;
  try {
    const r = await fetch(safe, { redirect: "manual", headers: { "User-Agent": UA, Accept: accept }, signal: AbortSignal.timeout(7000) });
    if (!r.ok || r.status >= 300 || !((r.headers.get("content-type") || "").includes("text/html") || accept.includes("application/json") && (r.headers.get("content-type") || "").includes("json"))) return null;
    const len = Number(r.headers.get("content-length") || 0);
    if (len > 1_500_000) return null;
    const t = await r.text();
    return t.length <= 1_500_000 ? t : null;
  } catch { return null; }
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
async function crawl(rawUrl, city, template) {
  const start = await safeUrl(rawUrl);
  if (!start) return [];
  const robotsUrl = start.origin + "/robots.txt";
  let robots = null;
  try {
    const rr = await fetch(robotsUrl, { redirect: "manual", headers: { "User-Agent": UA }, signal: AbortSignal.timeout(4000) });
    if (rr.status >= 300 && rr.status < 400 || rr.status >= 500) return [];
    if (rr.ok) robots = robotsParser(robotsUrl, await rr.text());
  } catch { return []; }
  const paths = [start.href, new URL("/contact", start.origin).href, new URL("/contact-us", start.origin).href];
  const out = [];
  for (const page of paths) {
    if (robots && robots.isAllowed(page, "CityMailFinder") === false) continue;
    const html = await fetchText(page);
    if (!html) continue;
    const $ = cheerio.load(html);
    const mailto = $('a[href^="mailto:"]').map((_, a) => $(a).attr("href") || "").get().join(" ");
    $("script,style,noscript,svg,iframe").remove();
    for (const email of emails($("body").text() + " " + mailto)) {
      out.push({ city, email, sourceUrl: page, domain: start.hostname, sourceType: "website", template, createdAt: new Date().toISOString() });
    }
  }
  return out;
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
      for (const email of emails(item.title + " " + item.description)) found.set(city.toLowerCase() + "|" + email, { city, email, sourceUrl: u.href, domain: u.hostname, sourceType: "search-result", template, createdAt: new Date().toISOString() });
      for (const row of await crawl(u.href, city, template)) found.set(city.toLowerCase() + "|" + row.email, row);
    }
    return res.status(200).json({ ok: true, provider: process.env.SEARXNG_URL ? "SearXNG" : "Tavily", count: found.size, results: [...found.values()] });
  } catch (e) {
    return res.status(502).json({ error: e.message || "Search failed" });
  }
}
