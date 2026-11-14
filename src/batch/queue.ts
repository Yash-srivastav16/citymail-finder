export type BatchJobStatus = "pending" | "running" | "completed" | "paused" | "failed";

export type BatchJob = {
  id: string;
  location: string;
  status: BatchJobStatus;
  collectedCount: number;
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
  return jobs.findIndex((job, index) => index >= fromIndex && (job.status === "pending" || job.status === "paused"));
}

export function createCheckpoint(jobs: BatchJob[], activeJobIndex: number): BatchCheckpoint {
  return {
    version: 1,
    jobs,
    activeJobIndex: Math.max(0, Math.min(activeJobIndex, Math.max(0, jobs.length - 1))),
    updatedAt: new Date().toISOString(),
  };
}

export function parseCheckpoint(value: string | null): BatchCheckpoint | null {
  if (!value) return null;

  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("version" in parsed) ||
      parsed.version !== 1 ||
      !("jobs" in parsed) ||
      !Array.isArray(parsed.jobs) ||
      !("activeJobIndex" in parsed) ||
      typeof parsed.activeJobIndex !== "number"
    ) {
      return null;
    }

    return parsed as BatchCheckpoint;
  } catch {
    return null;
  }
}
