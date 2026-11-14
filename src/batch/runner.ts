import {
  createCheckpoint,
  getNextRunnableJobIndex,
  type BatchJob,
} from "./queue";

export type LocationCollectionResult = {
  collectedCount: number;
  pageIndex: number;
  paused?: boolean;
};

export type LocationCollector = (
  location: string,
  startPageIndex: number,
  onProgress: (collectedCount: number, pageIndex: number) => void,
  shouldPause: () => boolean,
) => Promise<LocationCollectionResult>;

export type BatchRunnerOptions = {
  jobs: BatchJob[];
  startIndex?: number;
  collectLocation: LocationCollector;
  onJobsChange: (jobs: BatchJob[], activeIndex: number) => void;
  onCheckpoint: (value: string) => void;
  shouldPause: () => boolean;
};

/**
 * Runs locations sequentially. Each collector reports its page checkpoint so
 * a paused or interrupted location can resume at the exact next page.
 */
export async function runLocationBatch(options: BatchRunnerOptions): Promise<BatchJob[]> {
  const jobs = options.jobs.map((job) => ({ ...job }));
  let cursor = Math.max(0, options.startIndex ?? 0);

  while (true) {
    if (options.shouldPause()) {
      const active = getNextRunnableJobIndex(jobs, cursor);
      if (active >= 0) {
        jobs[active] = { ...jobs[active], status: "paused" };
        options.onJobsChange(jobs, active);
        options.onCheckpoint(JSON.stringify(createCheckpoint(jobs, active)));
      }
      return jobs;
    }

    const index = getNextRunnableJobIndex(jobs, cursor);
    if (index < 0) return jobs;

    const job = jobs[index];
    jobs[index] = { ...job, status: "running", error: undefined };
    options.onJobsChange(jobs, index);
    options.onCheckpoint(JSON.stringify(createCheckpoint(jobs, index)));

    try {
      const result = await options.collectLocation(
        job.location,
        job.pageIndex,
        (collectedCount, pageIndex) => {
          jobs[index] = { ...jobs[index], collectedCount, pageIndex };
          options.onJobsChange(jobs, index);
          options.onCheckpoint(JSON.stringify(createCheckpoint(jobs, index)));
        },
        options.shouldPause,
      );

      if (result.paused || options.shouldPause()) {
        jobs[index] = {
          ...jobs[index],
          status: "paused",
          collectedCount: result.collectedCount,
          pageIndex: result.pageIndex,
        };
        options.onJobsChange(jobs, index);
        options.onCheckpoint(JSON.stringify(createCheckpoint(jobs, index)));
        return jobs;
      }

      jobs[index] = {
        ...jobs[index],
        status: "completed",
        collectedCount: result.collectedCount,
        pageIndex: result.pageIndex,
      };
    } catch (error) {
      jobs[index] = {
        ...jobs[index],
        status: "failed",
        error: error instanceof Error ? error.message : "Collection failed",
      };
    }

    cursor = index + 1;
    options.onJobsChange(jobs, cursor);
    options.onCheckpoint(JSON.stringify(createCheckpoint(jobs, cursor)));
  }
}
