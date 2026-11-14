export type BatchJobStatus = "pending" | "running" | "completed" | "paused" | "failed";

export type BatchJob = {
  id: string;
  location: string;
  status: BatchJobStatus;
  collectedCount: number;
  pageIndex: number;
  error?: string;
};

export type BatchCheckpoint = {
  version: 1;
  jobs: BatchJob[];
  activeJobIndex: number;
  updatedAt: string;
};

export type BatchProgress = {
  total: number;
  completed: number;
  failed: number;
  pending: number;
  collected: number;
  percentage: number;
};

export function createBatchJobs(locations: string[]): BatchJob[] {
  const seen = new Set<string>();
  return locations
    .map((location) => location.trim())
    .filter((location) => {
      const key = location.toLocaleLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((location, index) => ({
      id: `location-${index}-${encodeURIComponent(location.toLocaleLowerCase())}`,
      location,
      status: "pending" as const,
      collectedCount: 0,
      pageIndex: 0,
    }));
}

export function getBatchProgress(jobs: BatchJob[]): BatchProgress {
  const completed = jobs.filter((job) => job.status === "completed").length;
  const failed = jobs.filter((job) => job.status === "failed").length;
  const pending = jobs.filter((job) => job.status === "pending" || job.status === "paused").length;
  const total = jobs.length;

  return {
    total,
    completed,
    failed,
    pending,
    collected: jobs.reduce((sum, job) => sum + job.collectedCount, 0),
    percentage: total === 0 ? 0 : Math.round((completed / total) * 100),
  };
}

export function getNextRunnableJobIndex(jobs: BatchJob[], fromIndex = 0): number {
  return jobs.findIndex((job, index) =>
    index >= fromIndex && (job.status === "pending" || job.status === "paused")
  );
}

export function createCheckpoint(jobs: BatchJob[], activeJobIndex: number): BatchCheckpoint {
  return {
    version: 1,
    jobs,
    activeJobIndex: Math.max(0, Math.min(activeJobIndex, Math.max(0, jobs.length - 1))),
    updatedAt: new Date().toISOString(),
  };
}

function isBatchJob(value: unknown): value is BatchJob {
  if (!value || typeof value !== "object") return false;
  const job = value as Record<string, unknown>;
  return typeof job.id === "string" &&
    typeof job.location === "string" &&
    ["pending", "running", "completed", "paused", "failed"].includes(String(job.status)) &&
    typeof job.collectedCount === "number" && Number.isFinite(job.collectedCount) &&
    job.collectedCount >= 0 &&
    typeof job.pageIndex === "number" && Number.isInteger(job.pageIndex) && job.pageIndex >= 0 &&
    (job.error === undefined || typeof job.error === "string");
}

export function parseCheckpoint(value: string | null): BatchCheckpoint | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    const checkpoint = parsed as Record<string, unknown>;
    if (checkpoint.version !== 1 ||
      !Array.isArray(checkpoint.jobs) ||
      !checkpoint.jobs.every(isBatchJob) ||
      typeof checkpoint.activeJobIndex !== "number" ||
      !Number.isInteger(checkpoint.activeJobIndex) ||
      checkpoint.activeJobIndex < 0 ||
      (checkpoint.jobs.length > 0 && checkpoint.activeJobIndex >= checkpoint.jobs.length) ||
      typeof checkpoint.updatedAt !== "string") return null;

    return {
      version: 1,
      jobs: checkpoint.jobs.map((job) =>
        job.status === "running" ? { ...job, status: "paused" as const } : job
      ),
      activeJobIndex: checkpoint.activeJobIndex,
      updatedAt: checkpoint.updatedAt,
    };
  } catch {
    return null;
  }
}
