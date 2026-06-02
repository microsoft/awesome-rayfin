import { useCallback, useEffect, useRef, useState } from 'react';

import type { Job } from '../../rayfin/data/Job';
import type { Customer } from '../../rayfin/data/Customer';
import type { Equipment } from '../../rayfin/data/Equipment';
import type { TaskItem } from '../../rayfin/data/TaskItem';
import type { JobLog, JobLogType } from '../../rayfin/data/JobLog';
import { ServiceContainer } from '../services/ServiceContainer';

const POLL_INTERVAL_MS = 30_000;

interface UseJobsResult {
  jobs: Job[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useTechnicianJobs(technicianProfileId: string | undefined): UseJobsResult {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initialLoad = useRef(true);

  const jobService = ServiceContainer.getInstance().jobService;

  const fetchJobs = useCallback(async () => {
    if (!technicianProfileId) return;
    if (initialLoad.current) {
      setLoading(true);
    }
    setError(null);
    try {
      const data = await jobService.getJobsForTechnician(technicianProfileId);
      setJobs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch jobs');
    } finally {
      setLoading(false);
      initialLoad.current = false;
    }
  }, [jobService, technicianProfileId]);

  useEffect(() => {
    initialLoad.current = true;
    fetchJobs();
    const id = setInterval(fetchJobs, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchJobs]);

  return { jobs, loading, error, refresh: fetchJobs };
}

export function useDispatcherJobs() {
  const [unscheduled, setUnscheduled] = useState<Job[]>([]);
  const [inProgress, setInProgress] = useState<Job[]>([]);
  const [overdue, setOverdue] = useState<Job[]>([]);
  const [helpRequests, setHelpRequests] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initialLoad = useRef(true);

  const jobService = ServiceContainer.getInstance().jobService;

  const fetchAll = useCallback(async () => {
    if (initialLoad.current) {
      setLoading(true);
    }
    setError(null);
    try {
      const [u, ip, o, h] = await Promise.all([
        jobService.getUnscheduledJobs(),
        jobService.getInProgressJobs(),
        jobService.getOverdueJobs(),
        jobService.getHelpRequestJobs(),
      ]);
      setUnscheduled(u);
      setInProgress(ip);
      // Filter overdue: scheduled jobs past their start time
      setOverdue(o.filter((j) => j.scheduledAt && new Date(j.scheduledAt) < new Date()));
      setHelpRequests(h);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch jobs');
    } finally {
      setLoading(false);
      initialLoad.current = false;
    }
  }, [jobService]);

  useEffect(() => {
    initialLoad.current = true;
    fetchAll();
    const id = setInterval(fetchAll, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchAll]);

  return { unscheduled, inProgress, overdue, helpRequests, loading, error, refresh: fetchAll };
}

export function useJobDetail(jobId: string) {
  const [job, setJob] = useState<Job | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [taskItems, setTaskItems] = useState<TaskItem[]>([]);
  const [logs, setLogs] = useState<JobLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const jobService = ServiceContainer.getInstance().jobService;
  const customerService = ServiceContainer.getInstance().customerService;

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [j, e, t, l] = await Promise.all([
        jobService.getJob(jobId),
        jobService.getEquipment(jobId),
        jobService.getTaskItems(jobId),
        jobService.getJobLogs(jobId),
      ]);
      setJob(j);
      setEquipment(e);
      setTaskItems(t);
      setLogs(l);
      // Fetch customer from the FK stored on the job
      if (j) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Rayfin returns FK fields that are not represented in the generated entity type
        const customerId = (j as any).customer_id ??
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Rayfin may also hydrate a partial relation object here
          (j as any).customer?.id;
        if (customerId) {
          const c = await customerService.getCustomer(customerId);
          setCustomer(c);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load job');
    } finally {
      setLoading(false);
    }
  }, [jobService, customerService, jobId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const updateStatus = useCallback(
    async (status: Job['status']) => {
      const updated = await jobService.updateJobStatus(jobId, status);
      setJob(updated);
    },
    [jobService, jobId]
  );

  const scheduleJob = useCallback(
    async (scheduledAt: Date | null) => {
      const updated = await jobService.scheduleJob(jobId, scheduledAt);
      setJob(updated);
    },
    [jobService, jobId]
  );

  const toggleOnSite = useCallback(
    async (isOnSite: boolean) => {
      const updated = await jobService.setOnSite(jobId, isOnSite);
      setJob(updated);
    },
    [jobService, jobId]
  );

  const requestHelp = useCallback(
    async (description: string) => {
      const updated = await jobService.requestHelp(jobId, description);
      setJob(updated);
    },
    [jobService, jobId]
  );

  const clearHelp = useCallback(async () => {
    const updated = await jobService.clearHelpRequest(jobId);
    setJob(updated);
  }, [jobService, jobId]);

  const addEquipment = useCallback(
    async (data: { name: string; serialNumber?: string; notes?: string }) => {
      const item = await jobService.addEquipment(jobId, data);
      setEquipment((prev) => [...prev, item]);
      return item;
    },
    [jobService, jobId]
  );

  const addTaskItem = useCallback(
    async (data: { description: string; sortOrder: number }) => {
      const item = await jobService.addTaskItem(jobId, data);
      setTaskItems((prev) => [...prev, item].sort((a, b) => a.sortOrder - b.sortOrder));
      return item;
    },
    [jobService, jobId]
  );

  const toggleTask = useCallback(
    async (taskId: string, isComplete: boolean) => {
      const updated = await jobService.toggleTaskItem(taskId, isComplete);
      setTaskItems((prev) =>
        prev.map((t) => (t.id === taskId ? updated : t))
      );
    },
    [jobService]
  );

  const addLog = useCallback(
    async (data: { type: JobLogType; message: string; imageUrl?: string }) => {
      const entry = await jobService.addJobLog(jobId, data);
      setLogs((prev) => [entry, ...prev]);
      return entry;
    },
    [jobService, jobId]
  );

  return {
    job,
    customer,
    equipment,
    taskItems,
    logs,
    loading,
    error,
    refresh: fetchAll,
    updateStatus,
    scheduleJob,
    toggleOnSite,
    requestHelp,
    clearHelp,
    addEquipment,
    addTaskItem,
    toggleTask,
    addLog,
  };
}
