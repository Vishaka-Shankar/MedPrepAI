import { DashboardData } from '../types/dashboard';

/**
 * MOCK dashboard data (the page shows a "Sample data" label). Replaced by the backend
 * (topic_mastery + topics + attempts) in M6. Study priorities are NOT stored here: the
 * page computes them from `topics` with P = weightage x (1 - mastery).
 */
export const MOCK_DASHBOARD: DashboardData = {
  summary: {
    correct: 82,
    attempts: 128, // 82 / 128 = 64% accuracy
    topicsPractised: 14,
    subjectsPractised: 3,
  },
  topics: [
    { subject: 'Biology', name: 'Cell biology', weightage: 0.03, mastery: 0.4, attempts: 18 },
    { subject: 'Biology', name: 'Genetics', weightage: 0.03, mastery: 0.5, attempts: 2 },
    { subject: 'Biology', name: 'Enzymes', weightage: 0.03, mastery: 0.72, attempts: 12 },
    { subject: 'Biology', name: 'Bioenergetics', weightage: 0.02, mastery: 0.55, attempts: 9 },
    { subject: 'Chemistry', name: 'Equilibrium', weightage: 0.025, mastery: 0.35, attempts: 14 },
    { subject: 'Chemistry', name: 'Organic basics', weightage: 0.025, mastery: 0.61, attempts: 11 },
    { subject: 'Chemistry', name: 'Thermochemistry', weightage: 0.015, mastery: 0.48, attempts: 8 },
    { subject: 'Chemistry', name: 'Atomic structure', weightage: 0.02, mastery: 0.8, attempts: 10 },
    { subject: 'Physics', name: 'Electrostatics', weightage: 0.02, mastery: 0.45, attempts: 13 },
    { subject: 'Physics', name: 'Waves', weightage: 0.015, mastery: 0.66, attempts: 9 },
    { subject: 'Physics', name: 'Kinematics', weightage: 0.025, mastery: 0.7, attempts: 12 },
    { subject: 'Physics', name: 'Optics', weightage: 0.015, mastery: 0.5, attempts: 3 },
  ],
};

/** Same shape as the future API call: a Promise of typed data. */
export function loadMockDashboard(): Promise<DashboardData> {
  return Promise.resolve(MOCK_DASHBOARD);
}
