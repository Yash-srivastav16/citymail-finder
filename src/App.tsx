import { useEffect, useState } from "react";
import * as XLSX from "xlsx";

type Result = { city: string; email: string; sourceUrl: string; domain: string; sourceType: string; createdAt: string };
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
    rows.forEach(row => store.put({ ...row, key: row.email.toLowerCase() }));
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
}
async function deleteRow(email: string) {
  const db = await dbOpen();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("results", "readwrite");
    tx.objectStore("results").delete(email.toLowerCase());
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
}
async function clearRows() {
  const db = await dbOpen();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("results", "readwrite");
    tx.objectStore("results").clear();
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
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function waitForTab(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); reject(new Error("Google page load timed out")); }, 30000);
    const listener = (updatedId: number, info: { status?: string }) => {
      if (updatedId === tabId && info.status === "complete") {
        window.clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then(tab => {
      if (tab.status === "complete") {
        window.clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }).catch(error => {
      window.clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      reject(error);
    });
  });
}
async function extractVisibleEmails(tabId: number) {
  const [injected] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const text = document.body?.innerText || "";
      const captcha = /unusual traffic|automated queries|not a robot|our systems have detected|sorry\/.*computer network/i.test(text);
      const emails = [...new Set((text.match(/[A-Z0-9.!#$%&'*+/=?^`_{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/gi) || []).map(x => x.toLowerCase()))];
      return { captcha, emails, title: document.title, url: location.href };
    }
  });
  return injected.result as { captcha: boolean; emails: string[]; title: string; url: string };
}
export default function App() {
  const [cities, setCities] = useState<string[]>(JSON.parse(localStorage.getItem("cm-cities") || "[]"));
  const [cityInput, setCityInput] = useState("");
  const [query, setQuery] = useState(localStorage.getItem("cm-query-v1") || '"\u007bcity\u007d" business email contact');
  const [pages, setPages] = useState(Number(localStorage.getItem("cm-pages-v2") || 10));
  const [results, setResults] = useState<Result[]>([]);
  const [status, setStatus] = useState("Ready");
  const [busy, setBusy] = useState(false);
  useEffect(() => { readRows().then(setResults).catch(e => setStatus(e.message)); }, []);
  useEffect(() => { localStorage.setItem("cm-cities", JSON.stringify(cities)); localStorage.setItem("cm-pages-v2", String(pages)); localStorage.setItem("cm-query-v1", query); }, [cities, pages, query]);

  async function importCities(file?: File) {
    if (!file) return;
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
      const header = Object.keys(rows[0] || {}).find(k => k.trim().toLowerCase() === "city");
      if (!header) throw new Error('Excel must contain a column named "City".');
      const imported = rows.map(row => String(row[header] || "").trim()).filter(Boolean);
      setCities(old => [...new Set([...old, ...imported])]);
      setStatus("Imported " + imported.length + " city rows.");
    } catch (e) { setStatus("Excel import failed: " + (e as Error).message); }
  }
  function addCities() {
    const next = cityInput.split(/[\n,;]+/).map(x => x.trim()).filter(Boolean);
    setCities(old => [...new Set([...old, ...next])]); setCityInput("");
  }
  function removeCity(city: string) {
    setCities(old => old.filter(item => item !== city));
    localStorage.removeItem("cm-search-checkpoint-v1");
    setStatus("Removed city: " + city + ". Search progress was reset; start again when ready.");
  }
  function clearCities() {
    if (!window.confirm("Remove all saved cities? Collected emails will be kept.")) return;
    setCities([]);
    localStorage.removeItem("cm-search-checkpoint-v1");
    setStatus("All cities removed. Collected emails are still saved.");
  }
  async function removeEmail(email: string) {
    await deleteRow(email);
    setResults(await readRows());
    setStatus("Removed " + email);
  }
  async function clearEmails() {
    if (!window.confirm("Delete all collected email addresses? This cannot be undone.")) return;
    await clearRows();
    setResults([]);
    setStatus("All collected emails deleted.");
  }
  async function clearAllData() {
    if (!window.confirm("Delete all saved cities, collected emails, and search progress? This cannot be undone.")) return;
    await clearRows();
    setResults([]);
    setCities([]);
    setCityInput("");
    setQuery('"\u007bcity\u007d" business email contact');
    setPages(10);
    localStorage.removeItem("cm-search-checkpoint-v1");
    setStatus("All saved cities, emails, search settings, and search progress have been cleared.");
  }
  async function run() {
    if (!cities.length) { setStatus("Import or add at least one city."); return; }
    if (!chrome?.tabs || !chrome?.scripting) { setStatus("Open this tool from the installed Chrome extension."); return; }
    setBusy(true);
    let tabId: number | undefined;
    let total = 0;
    let keepTabOpen = false;
    const checkpointKey = "cm-search-checkpoint-v1";
    const saved = JSON.parse(localStorage.getItem(checkpointKey) || "null") as { cityIndex: number; pageIndex: number } | null;
    const startCityIndex = saved?.cityIndex ?? 0;
    const startPageIndex = saved?.pageIndex ?? 0;
    try {
      for (let cityIndex = startCityIndex; cityIndex < cities.length; cityIndex++) {
        const city = cities[cityIndex];
        const firstPage = cityIndex === startCityIndex ? startPageIndex : 0;
        const search = query.replaceAll("{city}", city).trim();
        for (let page = firstPage; page < Math.min(50, Math.max(1, pages)); page++) {
          // Save the exact page before opening it. If Google interrupts the run,
          // the next Start click retries this page instead of restarting the batch.
          localStorage.setItem(checkpointKey, JSON.stringify({ cityIndex, pageIndex: page }));
          const url = "https://www.google.com/search?q=" + encodeURIComponent(search) + "&num=10&filter=0&start=" + (page * 10);
          setStatus("Opening Google · " + city + " · page " + (page + 1) + "/" + pages);
          if (tabId === undefined) {
            const tab = await chrome.tabs.create({ url, active: false });
            if (tab.id === undefined) throw new Error("Could not open Google tab.");
            tabId = tab.id;
            if (tab.status !== "complete") await waitForTab(tabId);
          } else {
            const loaded = waitForTab(tabId);
            await chrome.tabs.update(tabId, { url });
            await loaded;
          }
          await sleep(1500 + Math.floor(Math.random() * 1000));
          let pageData = await extractVisibleEmails(tabId);
          if (pageData.captcha) {
            keepTabOpen = true;
            await chrome.tabs.update(tabId, { active: true });
            setStatus("CAPTCHA at " + city + ", page " + (page + 1) + ". Solve it in the Google tab; searching will resume automatically (up to 5 minutes).");
            const deadline = Date.now() + 5 * 60 * 1000;
            while (Date.now() < deadline) {
              await sleep(1500);
              try {
                pageData = await extractVisibleEmails(tabId);
                if (!pageData.captcha) {
                  keepTabOpen = false;
                  setStatus("Verification cleared. Resuming " + city + " · page " + (page + 1) + "/" + pages);
                  break;
                }
              } catch {
                // Google may be navigating between the challenge and results page.
              }
            }
            if (pageData.captcha) {
              setStatus("Google verification is still showing at " + city + ", page " + (page + 1) + ". Solve it in the open Google tab, then click Start / Resume. The batch will continue from this page.");
              return;
            }
          }
          const rows: Result[] = pageData.emails.map(email => ({ city, email, sourceUrl: pageData.url, domain: "google.com", sourceType: "google-visible-result", createdAt: new Date().toISOString() }));
          if (rows.length) {
            await saveRows(rows); total += rows.length; setResults(await readRows());
          }
          // Mark the next page as the resume point only after this page is processed.
          localStorage.setItem(checkpointKey, JSON.stringify({ cityIndex, pageIndex: page + 1 }));
          if (page > 0 && pageData.emails.length === 0 && /did not match any documents|no results found/i.test(pageData.title)) break;
        }
      }
      localStorage.removeItem(checkpointKey);
      setStatus("Finished. Found " + total + " email matches; duplicates are removed.");
    } catch (e) {
      setStatus("Stopped: " + (e as Error).message);
    } finally {
      if (tabId !== undefined) {
        const tabs = await chrome.tabs.get(tabId).catch(() => null);
        if (tabs && !keepTabOpen && !/sorry|unusual traffic|captcha/i.test(tabs.url || "")) await chrome.tabs.remove(tabId).catch(() => undefined);
      }
      setBusy(false);
    }
  }
  function exportExcel() {
    const emails = [...new Set(results.map(r => r.email.toLowerCase()))];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Email"], ...emails.map(email => [email])]), "Emails");
    XLSX.writeFile(wb, "citymail-emails.xlsx");
  }
  return <main className="app">
    <header><h1>CityMail Finder</h1><p>Automatically collect email addresses visible in Google search results</p></header>
    <section><h2>Import cities</h2><label>Upload .xlsx or .csv (column name: City)<input type="file" accept=".xlsx,.xls,.csv" onChange={e => importCities(e.target.files?.[0])}/></label></section>
    <section><h2>Cities</h2><textarea value={cityInput} onChange={e => setCityInput(e.target.value)} placeholder="Add cities, one per line or comma separated"/><button onClick={addCities}>Add cities</button><button className="secondary" disabled={!cities.length || busy} onClick={clearCities}>Remove all cities</button><p>{cities.length} cities loaded</p><ul className="managed-list">{cities.map(city => <li key={city}><span>{city}</span><button className="danger small" disabled={busy} onClick={() => removeCity(city)}>Remove</button></li>)}</ul></section>
    <section><h2>Google search settings</h2><label>Search query (use {"{city}"} where city name should appear)<input value={query} onChange={e => setQuery(e.target.value)}/></label><label>Pages per city (1–50)<input type="number" min="1" max="50" value={pages} onChange={e => setPages(Math.min(50, Math.max(1, Number(e.target.value) || 1)))}/></label><p>Searches run page by page with a delay. Only emails visible on Google result pages are collected; business websites are not crawled.</p></section>
    <section><h2>Run</h2><button disabled={busy || !cities.length} onClick={run}>{busy ? "Searching Google…" : "Start / Resume search"}</button><button disabled={busy || !results.length} onClick={exportExcel}>Export emails only</button><p role="status">{status}</p><p>{new Set(results.map(r => r.email.toLowerCase())).size} unique email addresses saved locally</p></section>
    <section><h2>Collected emails</h2><button className="danger" disabled={busy || !results.length} onClick={clearEmails}>Delete all emails</button><div className="table"><table><thead><tr><th>Email</th><th>Action</th></tr></thead><tbody>{[...new Set(results.map(r => r.email.toLowerCase()))].map(email => <tr key={email}><td>{email}</td><td><button className="danger small" disabled={busy} onClick={() => removeEmail(email)}>Remove</button></td></tr>)}</tbody></table></div></section>
    <section><h2>Storage management</h2><p>Remove all saved cities, collected emails, and the saved search checkpoint from this browser.</p><button className="danger" disabled={busy} onClick={clearAllData}>Clear all saved data</button></section>
    <footer>Uses Google search results in your browser. Google may limit automated requests or show verification; the extension stops rather than bypassing it.</footer>
  </main>;
}
