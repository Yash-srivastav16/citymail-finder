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
type SearchApiResult = Partial<Result> & { city?: string; email: string };
const DB = "citymail-finder";
const CHECKPOINT_KEY = "cm-batch-checkpoint-v1";
const LEGACY_CHECKPOINT_KEY = "cm-search-checkpoint-v1";
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "https://citymail-finder.vercel.app").replace(/\/$/, "");

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
  const [maxResults, setMaxResults] = useState(Math.min(10, Math.max(1, Number(localStorage.getItem("cm-results-limit-v1") || 10))));
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
    localStorage.setItem("cm-results-limit-v1", String(maxResults));

    const checkpoint = parseCheckpoint(localStorage.getItem(CHECKPOINT_KEY));
    if (checkpoint && sameLocations(checkpoint.jobs, cities)) {
      setBatchJobs(checkpoint.jobs);
      setActiveJobIndex(checkpoint.activeJobIndex);
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
  }, [cities, maxResults, query]);

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
    setMaxResults(10);
    setBatchJobs([]);
    setActiveJobIndex(0);
    localStorage.removeItem(CHECKPOINT_KEY);
    localStorage.removeItem(LEGACY_CHECKPOINT_KEY);
    setStatus("All saved locations, emails, search settings, and batch progress have been cleared.");
  }

  async function run() {
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

          if (startPageIndex >= 1) {
            return { collectedCount: cityEmails.size, pageIndex: 1 };
          }
          if (shouldPause()) {
            return { collectedCount: cityEmails.size, pageIndex: 0, paused: true };
          }

          onProgress(cityEmails.size, 0);
          setStatus("Searching " + city + " (" + maxResults + " results maximum) via search API…");

          let response: Response;
          try {
            response = await fetch(API_BASE_URL + "/api/search", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ city, query: query.replaceAll("{city}", city).trim(), maxResults }),
              signal: AbortSignal.timeout(30000),
            });
          } catch (error) {
            throw new Error("Could not reach the search API at " + API_BASE_URL + ". " +
              (error instanceof Error ? error.message : "Network request failed"));
          }

          const body = await response.json().catch(() => ({})) as {
            ok?: boolean;
            provider?: string;
            error?: string;
            code?: string;
            results?: SearchApiResult[];
          };

          if (!response.ok) {
            if (response.status === 429 || body.code === "RATE_LIMITED" || body.code === "CAPTCHA_REQUIRED") {
              pauseReason = body.error || "Search provider rate limit or verification required. Resolve it with the provider, then resume.";
              return { collectedCount: cityEmails.size, pageIndex: 0, paused: true };
            }
            throw new Error(body.error || "Search API returned HTTP " + response.status);
          }

          if (body.ok !== true || !Array.isArray(body.results)) throw new Error("Search API returned an unexpected response. Check the configured API endpoint.");

          const found = body.results.slice(0, maxResults);
          const timestamp = new Date().toISOString();
          const rows: Result[] = found
            .filter(item => typeof item.email === "string" && item.email.includes("@"))
            .map(item => ({
              city: item.city || city,
              email: item.email.toLowerCase(),
              sourceUrl: item.sourceUrl || "",
              domain: item.domain || "",
              sourceType: item.sourceType || "search-result",
              createdAt: item.createdAt || timestamp,
            }));

          if (rows.length) {
            await saveRows(rows);
            rows.forEach(row => cityEmails.add(row.email));
            setResults(await readRows());
          }

          onProgress(cityEmails.size, 1);
          setStatus(city + " completed via " + (body.provider || "search provider") + ". Found " + rows.length + " matches.");
          return { collectedCount: cityEmails.size, pageIndex: 1 };
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
      <label>Maximum search results per location (1–10)
        <input type="number" min="1" max="10" value={maxResults} onChange={e => setMaxResults(Math.min(10, Math.max(1, Number(e.target.value) || 1)))}/>
      </label>
      <p>One search API request is made for each location. After the configured results are collected, the batch automatically moves to the next location.</p>
      <p><strong>Search provider:</strong> SearXNG is preferred when configured on the backend. The API may use its configured fallback provider if SearXNG is unavailable.</p>
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
      Search requests are sent to the configured CityMail Finder API and its configured search provider. The extension does not automate Google Search, solve CAPTCHA, or bypass provider access controls. All collected email matches are unverified.
    </footer>
  </main>;
}
