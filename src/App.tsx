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
  const [query, setQuery] = useState('"{city}" business email contact');
  const [results, setResults] = useState<Result[]>([]);
  const [status, setStatus] = useState("Ready");
  const [busy, setBusy] = useState(false);
  useEffect(() => { readRows().then(setResults).catch(e => setStatus(e.message)); }, []);
  useEffect(() => { localStorage.setItem("cm-api", api); localStorage.setItem("cm-token", token); localStorage.setItem("cm-cities", JSON.stringify(cities)); localStorage.setItem("cm-templates", JSON.stringify(templates)); }, [api, token, cities, templates]);
  const headers = { "Content-Type": "application/json", ...(token ? { "X-CityMail-Token": token } : {}) };
  function addCity() {
    const next = cityInput.split(/[\n,;]+/).map(x => x.trim()).filter(Boolean);
    setCities(old => [...new Set([...old, ...next])]); setCityInput("");
  }
  async function test() {
    try { const r = await fetch(api.replace(/\/$/, "") + "/api/health", { headers }); const b = await r.json(); if (!r.ok) throw new Error(b.error || r.statusText); setStatus("API connected · " + (b.configured?.searxng ? "SearXNG" : b.configured?.tavilyFallback ? "Tavily" : "No provider configured")); }
    catch (e) { setStatus("Connection failed: " + (e as Error).message); }
  }
  async function run() {
    if (!api || !cities.length || !templates.length) { setStatus("Set API URL, add a city and at least one template."); return; }
    setBusy(true); let done = 0, count = 0;
    try {
      for (const city of cities) for (const t of templates) {
        setStatus("Searching " + city + " · " + t.name + " (" + (++done) + "/" + (cities.length * templates.length) + ")");
        const r = await fetch(api.replace(/\/$/, "") + "/api/search", { method: "POST", headers, body: JSON.stringify({ city, query: t.query.replaceAll("{city}", city), template: t.name }) });
        const b = await r.json(); if (!r.ok) throw new Error(b.error || "Search failed");
        await saveRows(b.results || []); count += b.count || 0; setResults(await readRows());
      }
      setStatus("Completed. " + count + " records returned (local results are deduplicated).");
    } catch (e) { setStatus("Search stopped: " + (e as Error).message); }
    finally { setBusy(false); }
  }
  function exportExcel() {
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(results), "Emails");
    XLSX.writeFile(wb, "citymail-emails.xlsx");
  }
  return <main className="app">
    <header><h1>CityMail Finder</h1><p>Discover publicly listed business contact emails</p></header>
    <section><h2>Backend</h2><label>Vercel API URL<input value={api} onChange={e => setApi(e.target.value)} placeholder="https://your-project.vercel.app"/></label><label>Access token (optional)<input type="password" value={token} onChange={e => setToken(e.target.value)}/></label><button onClick={test}>Test connection</button></section>
    <section><h2>Cities</h2><textarea value={cityInput} onChange={e => setCityInput(e.target.value)} placeholder="Add cities, one per line or comma separated"/><button onClick={addCity}>Add cities</button><p>{cities.join(" · ") || "No cities added"}</p></section>
    <section><h2>Search template</h2><label>Query (must contain {"{city}"})<input value={query} onChange={e => setQuery(e.target.value)}/></label><button onClick={() => setTemplates(old => [...old, { name: "Template " + (old.length + 1), query }])}>Add template</button><ul>{templates.map((t, i) => <li key={i}>{t.name}: {t.query} <button onClick={() => setTemplates(old => old.filter((_, n) => n !== i))}>Remove</button></li>)}</ul></section>
    <section><h2>Search</h2><button disabled={busy} onClick={run}>{busy ? "Searching…" : "Start search"}</button> <button disabled={busy || !results.length} onClick={exportExcel}>Export Excel</button><p role="status">{status}</p><p>{results.length} unique city/email records saved locally</p></section>
    <section><h2>Results</h2><div className="table"><table><thead><tr><th>City</th><th>Email</th><th>Domain</th><th>Source</th></tr></thead><tbody>{results.map((r, i) => <tr key={i}><td>{r.city}</td><td>{r.email}</td><td>{r.domain}</td><td><a href={r.sourceUrl} target="_blank" rel="noreferrer">Open</a></td></tr>)}</tbody></table></div></section>
    <footer>Only public business contact information is processed. Respect site terms, robots.txt and rate limits.</footer>
  </main>;
}
