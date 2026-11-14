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
    const timer = window.setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Google page load timed out"));
    }, 30000);
    const listener = (updatedId: number, info: { status?: string }) => {
      if (updatedId === tabId && info.status === "complete") {
        window.clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
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

function sameLocations(jobs: BatchJob[], locations: string[]) {
  return jobs.length === locations.length &&
    jobs.every((job, index) => job.location.trim().toLocaleLowerCase() === locations[index].trim().toLocaleLowerCase());
}

export default function App() {
  const [cities, setCities] = useState<string[]>(JSON.parse(localStorage.getItem("cm-cities") || "[]"));
  const [cityInput, setCityInput] = useState("");
  const [query, setQuery] = useState(localStorage.getItem("cm-query-v1") || '"{city}" business email contact');
  const [pages, setPages] = useState(Number(localStorage.getItem("cm-pages-v2") || 10));
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
    localStorage.setItem("cm-pages-v2", String(pages));
    localStorage.setItem("cm-query-v1", query);

    const checkpoint = parseCheckpoint(localStorage.getItem(CHECKPOINT_KEY));
    if (checkpoint && sameLocations(checkpoint.jobs, cities)) {
      setBatchJobs(checkpoint.jobs);
      setActiveJobIndex(checkpoint.activeJobIndex);
      return;
    }

    // Migrate an older city/page checkpoint without losing its resume position.
    const legacyValue = localStorage.getItem(LEGACY_CHECKPOINT_KEY);
    if (legacyValue && cities.length) {
      try {
        const legacy = JSON.parse(legacyValue) as { cityIndex?: number; pageIndex?: number };
        if (Number.isInteger(legacy.cityIndex) && Number.isInteger(legacy.pageIndex) &&
          (legacy.cityIndex as number) >= 0 && (legacy.cityIndex as number) < cities.length &&
          (legacy.pageIndex as number) >= 0) {
          const migrated = createBatchJobs(cities).map((job, index) => ({
            ...job,
            status: index < (legacy.cityIndex as number) ? "completed" as const :
              index === legacy.cityIndex ? "paused" as const : "pending" as const,
            pageIndex: index === legacy.cityIndex ? legacy.pageIndex as number : 0,
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
      setStatus("Imported " + imported.length + " city rows.");
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
    setStatus("Removed city: " + city + ". Batch progress was reset; start again when ready.");
  }

  function clearCities() {
    if (!window.confirm("Remove all saved cities? Collected emails will be kept.")) return;
    setCities([]);
    setBatchJobs([]);
    setActiveJobIndex(0);
    localStorage.removeItem(CHECKPOINT_KEY);
    localStorage.removeItem(LEGACY_CHECKPOINT_KEY);
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
    setBatchJobs(old => old.map(job => ({ ...job, collectedCount: 0 })));
    setStatus("All collected emails deleted.");
  }

  async function clearAllData() {
    if (!window.confirm("Delete all saved cities, collected emails, and search progress? This cannot be undone.")) return;
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
    setStatus("All saved cities, emails, search settings, and batch progress have been cleared.");
  }

  async function run() {
    if (!cities.length) {
      setStatus("Import or add at least one city.");
      return;
    }
    if (!chrome?.tabs || !chrome?.scripting) {
      setStatus("Open this tool from the installed Chrome extension.");
      return;
    }

    const baseJobs = batchJobs.length && sameLocations(batchJobs, cities)
      ? batchJobs.map(job => job.status === "failed" ? { ...job, status: "pending" as const, error: undefined } : { ...job })
      : createBatchJobs(cities);
    const hasRunnable = baseJobs.some(job => job.status === "pending" || job.status === "paused");
    const jobs = hasRunnable ? baseJobs : createBatchJobs(cities);
    // Scan from the beginning so a failed location is retried even when the
    // last checkpoint cursor had already advanced to the following location.
    const nextIndex = getNextRunnableJobIndex(jobs, 0);
    const startIndex = nextIndex >= 0 ? nextIndex : 0;

    pauseRequested.current = false;
    setBusy(true);
    setBatchJobs(jobs);
    let tabId: number | undefined;
    let keepTabOpen = false;

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
          const cityEmails = new Set(
            (await readRows())
              .filter(row => row.city.toLocaleLowerCase() === city.toLocaleLowerCase())
              .map(row => row.email.toLowerCase())
          );
          const pageLimit = Math.min(50, Math.max(1, pages));
          const search = query.replaceAll("{city}", city).trim();

          for (let page = startPageIndex; page < pageLimit; page++) {
            if (shouldPause()) {
              return { collectedCount: cityEmails.size, pageIndex: page, paused: true };
            }

            // Persist the current page before navigation. If the extension closes
            // mid-request, resume retries this page instead of skipping it.
            onProgress(cityEmails.size, page);
            const url = "https://www.google.com/search?q=" + encodeURIComponent(search) + "&num=10&filter=0&start=" + (page * 10);
            setStatus("Processing " + city + " · page " + (page + 1) + "/" + pageLimit);

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
              setStatus("Verification required at " + city + ", page " + (page + 1) + ". Complete it manually in the Google tab; this batch will wait up to 5 minutes.");
              const deadline = Date.now() + 5 * 60 * 1000;
              while (Date.now() < deadline && !shouldPause()) {
                await sleep(1500);
                try {
                  pageData = await extractVisibleEmails(tabId);
                  if (!pageData.captcha) {
                    keepTabOpen = false;
                    setStatus("Verification cleared. Resuming " + city + " · page " + (page + 1) + "/" + pageLimit);
                    break;
                  }
                } catch {
                  // The challenge page may briefly navigate while the user verifies.
                }
              }
              if (pageData.captcha) {
                setStatus("Batch paused at " + city + ", page " + (page + 1) + ". Complete verification manually, then select Resume.");
                return { collectedCount: cityEmails.size, pageIndex: page, paused: true };
              }
            }

            const rows: Result[] = pageData.emails.map(email => ({
              city,
              email,
              sourceUrl: pageData.url,
              domain: "google.com",
              sourceType: "google-visible-result",
              createdAt: new Date().toISOString(),
            }));
            if (rows.length) {
              await saveRows(rows);
              rows.forEach(row => cityEmails.add(row.email.toLowerCase()));
              setResults(await readRows());
            }

            onProgress(cityEmails.size, page + 1);
            if (page > 0 && pageData.emails.length === 0 &&
              /did not match any documents|no results found/i.test(pageData.title)) break;
          }

          return { collectedCount: cityEmails.size, pageIndex: pageLimit };
        },
      });

      setBatchJobs(completedJobs);
      const progress = getBatchProgress(completedJobs);
      const hasPaused = completedJobs.some(job => job.status === "paused");
      const failed = completedJobs.filter(job => job.status === "failed");
      if (hasPaused) {
        setStatus("Batch paused. " + progress.completed + "/" + progress.total + " locations completed. Resume to continue from the saved page.");
      } else if (failed.length) {
        setStatus("Batch finished with " + failed.length + " failed location(s). " + progress.completed + "/" + progress.total + " completed; select Start / Resume to retry failed locations.");
      } else {
        localStorage.removeItem(CHECKPOINT_KEY);
        setStatus("All locations completed. " + progress.collected + " city-level email matches collected; duplicate email addresses are deduplicated in storage.");
      }
    } catch (e) {
      setStatus("Batch stopped: " + (e as Error).message);
    } finally {
      if (tabId !== undefined) {
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        if (tab && !keepTabOpen && !/sorry|unusual traffic|captcha/i.test(tab.url || "")) {
          await chrome.tabs.remove(tabId).catch(() => undefined);
        }
      }
      setBusy(false);
    }
  }

  function pause() {
    pauseRequested.current = true;
    setStatus("Pause requested. The current page will finish before the batch pauses.");
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
      <p>Collect email matches from search results across multiple cities, one location at a time</p>
    </header>

    <section>
      <h2>Import cities</h2>
      <label>Upload .xlsx or .csv (column name: City)
        <input type="file" accept=".xlsx,.xls,.csv" onChange={e => importCities(e.target.files?.[0])}/>
      </label>
    </section>

    <section>
      <h2>Cities</h2>
      <textarea value={cityInput} onChange={e => setCityInput(e.target.value)} placeholder="Add cities, one per line or comma separated"/>
      <button onClick={addCities}>Add cities</button>
      <button className="secondary" disabled={!cities.length || busy} onClick={clearCities}>Remove all cities</button>
      <p>{cities.length} cities loaded</p>
      <ul className="managed-list">
        {cities.map(city => <li key={city}><span>{city}</span><button className="danger small" disabled={busy} onClick={() => removeCity(city)}>Remove</button></li>)}
      </ul>
    </section>

    <section>
      <h2>Search settings</h2>
      <label>Search query (use {"{city}"} where city name should appear)
        <input value={query} onChange={e => setQuery(e.target.value)}/>
      </label>
      <label>Pages per city (1–50)
        <input type="number" min="1" max="50" value={pages} onChange={e => setPages(Math.min(50, Math.max(1, Number(e.target.value) || 1)))}/>
      </label>
      <p>Locations are processed sequentially. Each location runs through its configured page limit before the next location starts. Progress is saved after every page.</p>
      <p><strong>Manual verification required:</strong> Email-shaped matches are unverified. CityMail Finder does not verify ownership, validity, deliverability, or business association. Independently confirm each address before relying on it or contacting anyone.</p>
    </section>

    <section>
      <h2>Run batch</h2>
      <p><strong>Manual CAPTCHA handling:</strong> If Google displays a verification challenge, complete it yourself in the opened Google tab. CityMail Finder does not solve or bypass verification. If the challenge remains, the batch pauses and can resume from that location and page.</p>
      <button disabled={busy || !cities.length} onClick={run}>{busy ? "Processing locations…" : "Start / Resume batch"}</button>
      <button className="secondary" disabled={!busy} onClick={pause}>Pause after current page</button>
      <button disabled={busy || !results.length} onClick={exportExcel}>Export emails only</button>
      <p role="status">{status}</p>

      {batchJobs.length > 0 && <div className="batch-progress">
        <p><strong>{progress.percentage}% complete</strong> · {progress.completed}/{progress.total} locations completed · {progress.failed} failed · {progress.pending} pending/paused</p>
        <div style={{ height: 10, borderRadius: 8, background: "#28364b", overflow: "hidden" }}>
          <div style={{ width: progress.percentage + "%", height: "100%", background: "#4779d5", transition: "width .2s" }}/>
        </div>
        {activeJob && <p>Current / next location: <strong>{activeJob.location}</strong> · page {activeJob.pageIndex + 1}</p>}
        <div className="table">
          <table>
            <thead><tr><th>Location</th><th>Status</th><th>Pages</th><th>Email matches</th></tr></thead>
            <tbody>
              {batchJobs.map(job => <tr key={job.id}>
                <td>{job.location}</td>
                <td>{job.status}{job.error ? " — " + job.error : ""}</td>
                <td>{job.pageIndex}/{pages}</td>
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
      <p>Remove all saved cities, collected emails, and the saved batch checkpoint from this browser.</p>
      <button className="danger" disabled={busy} onClick={clearAllData}>Clear all saved data</button>
    </section>

    <footer>
      Search results are accessed in your browser. Search providers may limit automated requests or show verification. CAPTCHA challenges require your manual action; the extension never solves or bypasses them. All collected email matches are unverified and require independent manual verification.
    </footer>
  </main>;
}
