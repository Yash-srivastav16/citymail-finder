import { useEffect, useState } from "react";
import * as XLSX from "xlsx";

type City = string;
type Template = { name: string; query: string };
type Result = { city: string; email: string; sourceUrl: string; domain: string; sourceType: string; template?: string; createdAt: string };
const defaults: Template[] = [
  { name: "Business contact", query: '"{city}" business contact email' },
  { name: "Official contact page", query: '"{city}" "contact us" email' }
];
const DB = "citymail-finder";
function dbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains("results")) r.result.createObjectStore("results", { keyPath: "key" }); };
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
}
async function saveRows(rows: Result[]) {
  const db = await dbOpen();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("results", "readwrite"), store = tx.objectStore("results");
    rows.forEach(row => store.put({ ...row, key: row.city.trim().toLowerCase() + "|" + row.email.trim().toLowerCase() }));
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
}
async function readRows(): Promise<Result[]> {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const r = db.transaction("results", "readonly").objectStore("results").getAll();
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
}
export default function App() {
  const [api, setApi] = useState(localStorage.getItem("cm-api") || "");
  const [token, setToken] = useState(localStorage.getItem("cm-token") || "");
  const [cities, setCities] = useState<City[]>(JSON.parse(localStorage.getItem("cm-cities") || "[]"));
  const [templates, setTemplates] = useState<Template[]>(JSON.parse(localStorage.getItem("cm-templates") || "null") || defaults);
  const [cityInput, setCityInput] = useState("");
  const [paused, setPaused] = useState(false);
  const [resumeWait, setResumeWait] = useState<(() => void) | null>(null);
  const [pausedCity, setPausedCity] = useState("");
  const [pauseReason, setPauseReason] = useState("");
  const [query, setQuery] = useState('"{city}" business email contact');
  const [results, setResults] = useState<Result[]>([]);
  const [status, setStatus] = useState("Ready");
  const [busy, setBusy] = useState(false);
  useEffect(() => { readRows().then(setResults).catch(e => setStatus(e.message)); }, []);
  useEffect(() => { localStorage.setItem("cm-api", api); localStorage.setItem("cm-token", token); localStorage.setItem("cm-cities", JSON.stringify(cities)); localStorage.setItem("cm-templates", JSON.stringify(templates)); }, [api, token, cities, templates]);
  const headers = { "Content-Type": "application/json", ...(token ? { "X-CityMail-Token": token } : {}) };
  async function importCities(file?: File) {
    if (!file) return;
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      const header = Object.keys(rows[0] || {}).find(k => k.trim().toLowerCase() === "city");
      if (!header) throw new Error("Excel must contain a column named City.");
      const imported = rows.map(row => String(row[header] || "").trim()).filter(Boolean);
      if (!imported.length) throw new Error("No city names found in the City column.");
      setCities(old => [...new Set([...old, ...imported])]);
      setStatus("Imported " + imported.length + " city rows from Excel.");
    } catch (e) { setStatus("Excel import failed: " + (e as Error).message); }
  }
  function addCity() {
    const next = cityInput.split(/[\n,;]+/).map(x => x.trim()).filter(Boolean);
    setCities(old => [...new Set([...old, ...next])]); setCityInput("");
  }
  function openManualSearch(city: string, engine: "google" | "bing" = "google") {
    const searchQuery = query.replaceAll("{city}", city).trim();
    const base = engine === "google" ? "https://www.google.com/search?q=" : "https://www.bing.com/search?q=";
    const url = base + encodeURIComponent(searchQuery);
    if (typeof chrome !== "undefined" && chrome.tabs?.create) {
      chrome.tabs.create({ url });
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }
  async function test() {
    try { const r = await fetch(api.replace(/\/$/, "") + "/api/health", { headers }); const b = await r.json(); if (!r.ok) throw new Error(b.error || r.statusText); setStatus("API connected · " + (b.configured?.freesea ? "Freesea" : b.configured?.searxng ? "SearXNG" : b.configured?.tavilyFallback ? "Tavily" : "No provider configured")); }
    catch (e) { setStatus("Connection failed: " + (e as Error).message); }
  }
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  async function run() {
    if (!api || !cities.length || !templates.length) { setStatus("Set API URL, add a city and at least one template."); return; }
    setBusy(true); setPaused(false); let count = 0;
    try {
      for (const city of cities) for (const t of templates) {
        setStatus("Waiting before search · " + city);
        // Deliberately pace requests to reduce provider throttling.
        await sleep(12000 + Math.floor(Math.random() * 8000));
        setStatus("Searching " + city + " · " + t.name);
        const payload = { city, query: t.query.replaceAll("{city}", city), template: t.name };
        const r = await fetch(api.replace(/\\/$/, "") + "/api/search", { method: "POST", headers, body: JSON.stringify(payload) });
        const b = await r.json().catch(() => ({}));
        const errorText = String(b.error || "");
        const needsPause = r.status === 429 || b.code === "RATE_LIMITED" || b.code === "CAPTCHA_REQUIRED" ||
          /captcha|human verification|verify you are human|rate.?limit|too many requests|http 429/i.test(errorText);
        if (needsPause) {
          setPaused(true); setPausedCity(city);
          setPauseReason(/captcha|human verification|verify you are human/i.test(errorText) || b.code === "CAPTCHA_REQUIRED" ? "CAPTCHA / human verification" : "Provider rate limit");
          setStatus("Paused at " + city + ". Open the provider page manually, complete any verification, wait a little, then choose Resume.");
          await new Promise<void>(resolve => setResumeWait(() => resolve));
          setPaused(false); setResumeWait(null); setPausedCity(""); setPauseReason("");
          setStatus("Cooling down for 60 seconds before retrying " + city + "…");
          await sleep(60000);
          const retry = await fetch(api.replace(/\\/$/, "") + "/api/search", { method: "POST", headers, body: JSON.stringify(payload) });
          const retryBody = await retry.json().catch(() => ({}));
          if (!retry.ok) throw new Error(retryBody.error || "Search failed after manual resume. Queue stopped safely.");
          await saveRows(retryBody.results || []); count += retryBody.count || 0; setResults(await readRows());
          continue;
        }
        if (!r.ok) throw new Error(errorText || "Search failed");
        await saveRows(b.results || []); count += b.count || 0; setResults(await readRows());
      }
      setStatus("Completed. " + count + " records returned (local results are deduplicated).");
    } catch (e) { setStatus("Search stopped: " + (e as Error).message); }
    finally { setBusy(false); setPaused(false); }
  }
  function exportExcel() {
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Email"], ...[...new Set(results.map(r => r.email.toLowerCase()))].map(email => [email])]), "Emails");
    XLSX.writeFile(wb, "citymail-emails.xlsx");
  }
  return <main className="app">
    <header><h1>CityMail Finder</h1><p>Discover publicly listed business contact emails</p></header>
    <section><h2>Backend</h2><label>Vercel API URL<input value={api} onChange={e => setApi(e.target.value)} placeholder="https://your-project.vercel.app"/></label><label>Access token (optional)<input type="password" value={token} onChange={e => setToken(e.target.value)}/></label><button onClick={test}>Test connection</button></section>
    <section><h2>Import cities from Excel</h2><label>Upload .xlsx or .csv (requires a column named City)<input type="file" accept=".xlsx,.xls,.csv" onChange={e => importCities(e.target.files?.[0])}/></label></section><section><h2>Cities</h2><textarea value={cityInput} onChange={e => setCityInput(e.target.value)} placeholder="Add cities, one per line or comma separated"/><button onClick={addCity}>Add cities</button><div className="city-list">{cities.length ? cities.map(city => <div className="city-row" key={city}><span>{city}</span><div><button type="button" onClick={() => openManualSearch(city, "google")}>Google search</button> <button type="button" onClick={() => openManualSearch(city, "bing")}>Bing search</button></div></div>) : <p>No cities added</p>}</div></section>
    <section><h2>Search template</h2><label>Query (must contain {"{city}"})<input value={query} onChange={e => setQuery(e.target.value)}/></label><button onClick={() => setTemplates(old => [...old, { name: "Template " + (old.length + 1), query }])}>Add template</button><ul>{templates.map((t, i) => <li key={i}>{t.name}: {t.query} <button onClick={() => setTemplates(old => old.filter((_, n) => n !== i))}>Remove</button></li>)}</ul></section>
    <section><h2>Search</h2><button disabled={busy} onClick={run}>{busy ? "Searching…" : "Start search"}</button> {paused && <><p><strong>{pauseReason}</strong> · {pausedCity}</p><button onClick={() => openManualSearch(pausedCity, "google")}>Open Google page manually</button> <button onClick={() => resumeWait?.()}>Resume after verification</button></>} <button disabled={busy || !results.length} onClick={exportExcel}>Export emails only</button><p role="status">{status}</p><p>{results.length} unique city/email records saved locally</p></section>
    <section><h2>Collected emails</h2><p>{new Set(results.map(r => r.email.toLowerCase())).size} unique email addresses</p><div className="table"><table><thead><tr><th>Email</th></tr></thead><tbody>{[...new Set(results.map(r => r.email.toLowerCase()))].map(email => <tr key={email}><td>{email}</td></tr>)}</tbody></table></div></section>
    <footer>Only public business contact information is processed. Respect site terms, robots.txt and rate limits.</footer>
  </main>;
}
