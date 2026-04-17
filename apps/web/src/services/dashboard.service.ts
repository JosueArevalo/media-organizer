export type DashboardStats = {
  totalItems: number;
  photos: number;
  videos: number;
  estimatedSavingsMb: number;
  pendingJobs: number;
};

export type RecentJob = {
  id: string;
  label: string;
  stage: string;
  progress: number;
  updatedAt: string;
};

export type BackendHealth = {
  status: string;
  service: string;
  time: string;
  dbPath: string;
  appliedMigrations: string[];
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const getDashboardStats = async (): Promise<DashboardStats> => {
  await delay(220);

  return {
    totalItems: 1342,
    photos: 1180,
    videos: 162,
    estimatedSavingsMb: 2840,
    pendingJobs: 3
  };
};

export const getRecentJobs = async (): Promise<RecentJob[]> => {
  await delay(280);

  return [
    {
      id: 'job-2026-04-11',
      label: 'Spring cleanup from Pixel backup',
      stage: 'Selection reviewed',
      progress: 64,
      updatedAt: '2026-04-11 21:15'
    },
    {
      id: 'job-2026-04-09',
      label: 'WhatsApp export batch',
      stage: 'Compression paused',
      progress: 37,
      updatedAt: '2026-04-09 19:42'
    },
    {
      id: 'job-2026-04-01',
      label: 'Family event videos',
      stage: 'Ready to apply',
      progress: 92,
      updatedAt: '2026-04-01 23:04'
    }
  ];
};

export const getBackendHealth = async (): Promise<BackendHealth> => {
  const response = await fetch('/api/health');

  if (!response.ok) {
    throw new Error(`Backend responded with ${response.status}`);
  }

  return (await response.json()) as BackendHealth;
};
