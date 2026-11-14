import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  createBatchJobs,
  createCheckpoint,
  getBatchProgress,
  getNextRunnableJobIndex,
  parseCheckpoint,
  type BatchJob,
} from "./batch/queue";
import { runLocationBatch } from "./batch/runner";

type Result = { city: string; email: string; sourceUrl: string; domain: string; sourceType: string; createdAt: string };
const DB = "citymail-finder";
const CHECKPOINT_KEY = "cm-batch-checkpoint-v1";
const LEGACY_CHECKPOINT_KEY = "cm-search-checkpoint-v1";

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
function navigateTab(tabId: number, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Google next-results page load timed out"));
    }, 30000);
    const listener = (updatedId: number, info: { status?: string }) => {
      if (updatedId === tabId && info.status === "complete") {
        window.clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.update(tabId, { url }).catch(error => {
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
async function scrollGoogleResults(tabId: number) {
  const [injected] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async () => {
      const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      const resultCount = () => document.querySelectorAll("#search .MjjYud, #search .g, #rso > div").length;
      let previousHeight = document.documentElement.scrollHeight;
      let previousCount = resultCount();
      let stableRounds = 0;
      let grewDuringScroll = false;
      let scrolls = 0;

      // Keep scrolling in the same Google tab. On continuous-scroll layouts,
      // this allows newly appended results to load before we extract emails.
      for (let i = 0; i < 12; i++) {
        window.scrollTo(0, document.documentElement.scrollHeight);
        await sleep(1100);
        const height = document.documentElement.scrollHeight;
        const count = resultCount();
        if (height > previousHeight || count > previousCount) {
          grewDuringScroll = true;
          stableRounds = 0;
        } else {
          stableRounds++;
        }
        previousHeight = height;
        previousCount = count;
        scrolls++;
        if (stableRounds >= 2) break;
      }

      const bodyText = document.body?.innerText || "";
      const captcha = /unusual traffic|automated queries|not a robot|our systems have detected|sorry\/.*computer network/i.test(bodyText);
      const emails = [...new Set((bodyText.match(/[A-Z0-9.!#$%&'*+/=?^`_{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/gi) || []).map(x => x.toLowerCase()))];

      // Desktop Google normally exposes a Next link. Prefer it when the page
      // does not append more results while scrolling.
      const next = document.querySelector<HTMLAnchorElement>("#pnnext, a[aria-label='Next'], a[aria-label='More results']") ||
        [...document.querySelectorAll<HTMLAnchorElement>("a[href]")].find(a => /^(next|more results)$/i.test((a.innerText || a.getAttribute("aria-label") || "").trim()));
      return {
        captcha, emails, title: document.title, url: location.href,
        nextUrl: next?.href || null,
        scrollLimitReached: scrolls === 12 && stableRounds < 2,
        scrolls, grewDuringScroll
      };
    }
  });
  return injected.result as {
    captcha: boolean; emails: string[]; title: string; url: string;
    nextUrl: string | null; scrollLimitReached: boolean; scrolls: number; grewDuringScroll: boolean;
  };
}
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

function sameLocations(jobs: BatchJob[], locations: string[]) {
  return jobs.length === locations.length &&
    jobs.every((job, index) => job.location.trim().toLocaleLowerCase() === locations[index].trim().toLocaleLowerCase());
}

export default function App() {
  const [cities, setCities] = useState<string[]>(JSON.parse(localStorage.getItem("cm-cities") || "[]"));
  const [cityInput, setCityInput] = useState("");
  const [query, setQuery] = useState(localStorage.getItem("cm-query-v1") || '"{city}" business email contact');
  const [pages, setPages] = useState(Math.min(50, Math.max(1, Number(localStorage.getItem("cm-pages-v2") || 10))));
  const [results, setResults] = useState<Result[]>([]);
  const [status, setStatus] = useState("Ready");
  const [busy, setBusy] = useState(false);
  const [batchJobs, setBatchJobs] = useState<BatchJob[]>([]);
  const [activeJobIndex, setActiveJobIndex] = useState(0);
  const pauseRequested = useRef(false);

  useEffect(() => {
    readRows().then(setResults).catch(e => setStatus(e.message));
  }, []);

  useEffect(() => {
    localStorage.setItem("cm-cities", JSON.stringify(cities));
    localStorage.setItem("cm-query-v1", query);
    localStorage.setItem("cm-pages-v2", String(pages));

    const checkpoint = parseCheckpoint(localStorage.getItem(CHECKPOINT_KEY));
    if (checkpoint && cities.length) {
      const previousByLocation = new Map(
        checkpoint.jobs.map(job => [job.location.trim().toLocaleLowerCase(), job])
      );
      const mergedJobs = createBatchJobs(cities).map(job => {
        const previous = previousByLocation.get(job.location.toLocaleLowerCase());
        return previous ? { ...previous, id: job.id, location: job.location } : job;
      });
      const nextRunnable = getNextRunnableJobIndex(mergedJobs, 0);
      const nextActiveIndex = nextRunnable >= 0 ? nextRunnable : Math.max(0, mergedJobs.length - 1);
      setBatchJobs(mergedJobs);
      setActiveJobIndex(nextActiveIndex);
      localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(createCheckpoint(mergedJobs, nextActiveIndex)));
      return;
    }

    // Migrate the older city/page checkpoint. The API collector performs one
    // search request per location, so the current location restarts once.
    const legacyValue = localStorage.getItem(LEGACY_CHECKPOINT_KEY);
    if (legacyValue && cities.length) {
      try {
        const legacy = JSON.parse(legacyValue) as { cityIndex?: number };
        if (Number.isInteger(legacy.cityIndex) &&
          (legacy.cityIndex as number) >= 0 && (legacy.cityIndex as number) < cities.length) {
          const migrated = createBatchJobs(cities).map((job, index) => ({
            ...job,
            status: index < (legacy.cityIndex as number) ? "completed" as const :
              index === legacy.cityIndex ? "paused" as const : "pending" as const,
            pageIndex: 0,
          }));
          const migratedIndex = legacy.cityIndex as number;
          setBatchJobs(migrated);
          setActiveJobIndex(migratedIndex);
          localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(createCheckpoint(migrated, migratedIndex)));
          localStorage.removeItem(LEGACY_CHECKPOINT_KEY);
          return;
        }
      } catch {
        localStorage.removeItem(LEGACY_CHECKPOINT_KEY);
      }
    }

    setBatchJobs([]);
    setActiveJobIndex(0);
    if (localStorage.getItem(CHECKPOINT_KEY)) localStorage.removeItem(CHECKPOINT_KEY);
  }, [cities, pages, query]);

  async function importCities(file?: File) {
    if (!file) return;
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
      const header = Object.keys(rows[0] || {}).find(k => k.trim().toLowerCase() === "city");
      if (!header) throw new Error('Excel must contain a column named "City".');
      const imported = rows.map(row => String(row[header] || "").trim()).filter(Boolean);
      setCities(old => [...new Set([...old, ...imported])]);
      setStatus("Imported " + imported.length + " location rows.");
    } catch (e) {
      setStatus("Excel import failed: " + (e as Error).message);
    }
  }

  function addCities() {
    const next = cityInput.split(/[\n,;]+/).map(x => x.trim()).filter(Boolean);
    setCities(old => [...new Set([...old, ...next])]);
    setCityInput("");
  }

  function removeCity(city: string) {
    setCities(old => old.filter(item => item !== city));
    setBatchJobs([]);
    setActiveJobIndex(0);
    localStorage.removeItem(CHECKPOINT_KEY);
    localStorage.removeItem(LEGACY_CHECKPOINT_KEY);
    setStatus("Removed location: " + city + ". Batch progress was reset; start again when ready.");
  }

  function clearCities() {
    if (!window.confirm("Remove all saved locations? Collected emails will be kept.")) return;
    setCities([]);
    setBatchJobs([]);
    setActiveJobIndex(0);
    localStorage.removeItem(CHECKPOINT_KEY);
    localStorage.removeItem(LEGACY_CHECKPOINT_KEY);
    setStatus("All locations removed. Collected emails are still saved.");
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
    setBatchJobs(old => old.map(job => ({ ...job, collectedCount: 0 })));
    setStatus("All collected emails deleted.");
  }

  async function clearAllData() {
    if (!window.confirm("Delete all saved locations, collected emails, and search progress? This cannot be undone.")) return;
    await clearRows();
    setResults([]);
    setCities([]);
    setCityInput("");
    setQuery('"{city}" business email contact');
    setPages(10);
    setBatchJobs([]);
    setActiveJobIndex(0);
    localStorage.removeItem(CHECKPOINT_KEY);
    localStorage.removeItem(LEGACY_CHECKPOINT_KEY);
    setStatus("All saved locations, emails, search settings, and batch progress have been cleared.");
  }

  async function run() {
    // Chrome extension APIs are only available in the installed extension context,
    // not when this React UI is opened as a normal Vercel website.
    if (typeof chrome === "undefined" || !chrome.tabs?.create || !chrome.scripting?.executeScript) {
      setStatus("Google Search collection needs the installed Chrome extension. Build the extension, load the dist folder at chrome://extensions, then open CityMail Finder from Chrome. This website preview is for checking the UI only.");
      return;
    }
    if (!cities.length) {
      setStatus("Import or add at least one location.");
      return;
    }

    const baseJobs = batchJobs.length && sameLocations(batchJobs, cities)
      ? batchJobs.map(job => job.status === "failed" ? { ...job, status: "pending" as const, error: undefined } : { ...job })
      : createBatchJobs(cities);
    const hasRunnable = baseJobs.some(job => job.status === "pending" || job.status === "paused");
    const jobs = hasRunnable ? baseJobs : createBatchJobs(cities);
    // Start at the earliest runnable item so failed locations are retried too.
    const nextIndex = getNextRunnableJobIndex(jobs, 0);
    const startIndex = nextIndex >= 0 ? nextIndex : 0;

    pauseRequested.current = false;
    setBusy(true);
    setBatchJobs(jobs);
    let pauseReason = "";
    let googleTabId: number | undefined;
    let keepGoogleTabOpen = false;

    try {
      const completedJobs = await runLocationBatch({
        jobs,
        startIndex,
        shouldPause: () => pauseRequested.current,
        onJobsChange: (nextJobs, index) => {
          setBatchJobs(nextJobs.map(job => ({ ...job })));
          setActiveJobIndex(index);
        },
        onCheckpoint: value => localStorage.setItem(CHECKPOINT_KEY, value),
        collectLocation: async (city, startPageIndex, onProgress, shouldPause) => {
          const cityEmails = new Set((await readRows()).filter(row => row.city.toLowerCase() === city.toLowerCase()).map(row => row.email.toLowerCase()));
          const maxPages = Math.min(50, Math.max(1, pages));
          const searchUrl = "https://www.google.com/search?q=" + encodeURIComponent(query.replaceAll("{city}", city).trim()) + "&num=10&filter=0&start=" + (Math.max(0, startPageIndex) * 10);
          if (googleTabId === undefined) {
            const tab = await chrome.tabs.create({ url: searchUrl, active: true });
            if (typeof tab.id !== "number") throw new Error("Could not open Google Search tab.");
            googleTabId = tab.id;
            if (tab.status !== "complete") await waitForTab(googleTabId);
          }

          let completedBatches = Math.max(0, startPageIndex);
          for (let page = Math.max(0, startPageIndex); page < maxPages; page++) {
            if (shouldPause()) return { collectedCount: cityEmails.size, pageIndex: page, paused: true };
            onProgress(cityEmails.size, page);
            setStatus("Scrolling Google Search · " + city + " · result batch " + (page + 1) + "/" + maxPages);
            await sleep(900);
            let pageData = await scrollGoogleResults(googleTabId);
            if (pageData.captcha) {
              keepGoogleTabOpen = true;
              await chrome.tabs.update(googleTabId, { active: true });
              setStatus("Google verification required. Solve it manually in the open tab; collection will wait up to 5 minutes.");
              const deadline = Date.now() + 5 * 60 * 1000;
              while (Date.now() < deadline) {
                await sleep(1500);
                try { pageData = await scrollGoogleResults(googleTabId); if (!pageData.captcha) { keepGoogleTabOpen = false; break; } } catch { /* page is navigating */ }
              }
              if (pageData.captcha) {
                pauseReason = "Google verification remains unresolved. Solve it in the open tab, then select Start / Resume.";
                return { collectedCount: cityEmails.size, pageIndex: page, paused: true };
              }
            }

            const timestamp = new Date().toISOString();
            const rows: Result[] = pageData.emails.filter(email => !cityEmails.has(email.toLowerCase())).map(email => ({
              city, email: email.toLowerCase(), sourceUrl: pageData.url, domain: "google.com",
              sourceType: "google-visible-result", createdAt: timestamp,
            }));
            if (rows.length) { await saveRows(rows); rows.forEach(row => cityEmails.add(row.email)); setResults(await readRows()); }
            onProgress(cityEmails.size, page + 1);
            setStatus(city + " · result batch " + (page + 1) + "/" + maxPages + " · " + pageData.scrolls + " scrolls · " + cityEmails.size + " unique matches");

            if (shouldPause()) return { collectedCount: cityEmails.size, pageIndex: page + 1, paused: true };
            if (page + 1 >= maxPages) break;

            if (pageData.nextUrl) {
              // Desktop Google fallback: automatically follow its Next link in
              // the same tab when scrolling no longer appends more results.
              const loaded = waitForTab(googleTabId);
              await chrome.tabs.update(googleTabId, { url: pageData.nextUrl });
              await loaded;
            } else if (pageData.scrollLimitReached) {
              // A continuous-scroll layout is still appending results. Keep the
              // same URL and continue scrolling in the next batch iteration.
              continue;
            } else {
              // No additional results and no Next link.
              break;
            }
          }
          return { collectedCount: cityEmails.size, pageIndex: completedBatches };
        },
      });

      setBatchJobs(completedJobs);
      const progress = getBatchProgress(completedJobs);
      const hasPaused = completedJobs.some(job => job.status === "paused");
      const failed = completedJobs.filter(job => job.status === "failed");
      if (hasPaused) {
        setStatus(pauseReason || ("Batch paused. " + progress.completed + "/" + progress.total + " locations completed. Resume to continue."));
      } else if (failed.length) {
        setStatus("Batch finished with " + failed.length + " failed location(s). " + progress.completed + "/" + progress.total + " completed; select Start / Resume to retry failed locations.");
      } else {
        localStorage.removeItem(CHECKPOINT_KEY);
        setStatus("All locations completed. " + progress.collected + " city-level email matches collected; duplicate email addresses are deduplicated in storage.");
      }
    } catch (e) {
      setStatus("Batch stopped: " + (e as Error).message);
    } finally {
      if (googleTabId !== undefined && !keepGoogleTabOpen) await chrome.tabs.remove(googleTabId).catch(() => undefined);
      setBusy(false);
    }
  }

  function pause() {
    pauseRequested.current = true;
    setStatus("Pause requested. The current location search will finish before the batch pauses.");
  }

  function exportExcel() {
    const emails = [...new Set(results.map(r => r.email.toLowerCase()))];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Email"], ...emails.map(email => [email])]), "Emails");
    XLSX.writeFile(wb, "citymail-emails.xlsx");
  }

  const progress = getBatchProgress(batchJobs);
  const activeJob = batchJobs[activeJobIndex];

  return <main className="app">
    <header>
      <h1>CityMail Finder</h1>
      <p>Automatically search multiple locations and collect email matches, one location at a time</p>
    </header>

    <section>
      <h2>Import locations</h2>
      <label>Upload .xlsx or .csv (column name: City)
        <input type="file" accept=".xlsx,.xls,.csv" onChange={e => importCities(e.target.files?.[0])}/>
      </label>
    </section>

    <section>
      <h2>Locations</h2>
      <textarea value={cityInput} onChange={e => setCityInput(e.target.value)} placeholder="Add locations, one per line or comma separated"/>
      <button onClick={addCities}>Add locations</button>
      <button className="secondary" disabled={!cities.length || busy} onClick={clearCities}>Remove all locations</button>
      <p>{cities.length} locations loaded</p>
      <ul className="managed-list">
        {cities.map(city => <li key={city}><span>{city}</span><button className="danger small" disabled={busy} onClick={() => removeCity(city)}>Remove</button></li>)}
      </ul>
    </section>

    <section>
      <h2>Search settings</h2>
      <label>Search query (use {"{city}"} where the location name should appear)
        <input value={query} onChange={e => setQuery(e.target.value)}/>
      </label>
      <label>Google Search pages per location (1–50)
        <input type="number" min="1" max="10" value={pages} onChange={e => setPages(Math.min(50, Math.max(1, Number(e.target.value) || 1)))}/>
      </label>
      <p>The extension scrolls Google Search in one tab to load additional results where continuous scrolling is available. If Google uses numbered desktop pages, it automatically follows the Next link in that same tab.</p>
      <p><strong>Search method:</strong> Chrome tab automation using Google Search pages. No search API key or external provider is configured.</p>
      <p><strong>Important:</strong> Email-shaped matches from search-result snippets are unverified. This version does not crawl linked business websites or verify ownership, validity, deliverability, or business association. Independently confirm each address before relying on it or contacting anyone.</p>
    </section>

    <section>
      <h2>Run batch</h2>
      <button disabled={busy || !cities.length} onClick={run}>{busy ? "Searching locations…" : "Start / Resume batch"}</button>
      <button className="secondary" disabled={!busy} onClick={pause}>Pause after current location</button>
      <button disabled={busy || !results.length} onClick={exportExcel}>Export emails only</button>
      <p role="status">{status}</p>

      {batchJobs.length > 0 && <div className="batch-progress">
        <p><strong>{progress.percentage}% complete</strong> · {progress.completed}/{progress.total} locations completed · {progress.failed} failed · {progress.pending} pending/paused</p>
        <div style={{ height: 10, borderRadius: 8, background: "#28364b", overflow: "hidden" }}>
          <div style={{ width: progress.percentage + "%", height: "100%", background: "#4779d5", transition: "width .2s" }}/>
        </div>
        {activeJob && <p>Current / next location: <strong>{activeJob.location}</strong></p>}
        <div className="table">
          <table>
            <thead><tr><th>Location</th><th>Status</th><th>Search</th><th>Email matches</th></tr></thead>
            <tbody>
              {batchJobs.map(job => <tr key={job.id}>
                <td>{job.location}</td>
                <td>{job.status}{job.error ? " — " + job.error : ""}</td>
                <td>{job.pageIndex >= 1 ? "Done" : "Not started"}</td>
                <td>{job.collectedCount}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </div>}
      <p>{new Set(results.map(r => r.email.toLowerCase())).size} unique email addresses saved locally</p>
    </section>

    <section>
      <h2>Collected emails</h2>
      <button className="danger" disabled={busy || !results.length} onClick={clearEmails}>Delete all emails</button>
      <div className="table">
        <table>
          <thead><tr><th>Email</th><th>Action</th></tr></thead>
          <tbody>
            {[...new Set(results.map(r => r.email.toLowerCase()))].map(email =>
              <tr key={email}><td>{email}</td><td><button className="danger small" disabled={busy} onClick={() => removeEmail(email)}>Remove</button></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>

    <section>
      <h2>Storage management</h2>
      <p>Remove all saved locations, collected emails, and the saved batch checkpoint from this browser.</p>
      <button className="danger" disabled={busy} onClick={clearAllData}>Clear all saved data</button>
    </section>

    <footer>
      Google Search is scrolled in Chrome; where continuous scrolling is unavailable, the extension follows Google’s Next link automatically in the same tab. Verification challenges require manual handling. The extension does not bypass CAPTCHA or access controls. All collected email matches are unverified.
    </footer>
  </main>;
}
