import { loadMockDashboard } from '../mocks/dashboard';
import { DashboardData } from '../types/dashboard';
import { AsyncData, useAsyncData } from './useAsyncData';

/**
 * The Dashboard's data. TODAY: mock data (src/mocks/dashboard.ts).
 * LATER (M6): replace `loadMockDashboard` with an API call that returns Promise<DashboardData>;
 * the page itself does not change.
 */
export function useDashboardData(): AsyncData<DashboardData> {
  return useAsyncData(loadMockDashboard);
}

/** True while the page shows mock data (drives the "Sample data" label). */
export const DASHBOARD_IS_SAMPLE = true;
