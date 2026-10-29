/** Data the Dashboard needs. Today it comes from src/mocks/dashboard.ts; later from the backend (M6). */

export interface TopicStat {
  subject: 'Biology' | 'Chemistry' | 'Physics';
  name: string;
  weightage: number; // w_t: the topic's share of the MDCAT paper (0-1)
  mastery: number; // M_t (0-1)
  attempts: number;
}

export interface DashboardSummary {
  correct: number;
  attempts: number;
  topicsPractised: number;
  subjectsPractised: number;
}

export interface DashboardData {
  summary: DashboardSummary;
  topics: TopicStat[];
}
