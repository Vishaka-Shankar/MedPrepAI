/**
 * The diagnostic model from proposal section 5.1, as used by the Dashboard.
 *   M_t: mastery of topic t (0-1)
 *   w_t: MDCAT weightage of topic t (0-1)
 *   P_t = w_t * (1 - M_t)  -> study priority: high when a topic is heavily tested AND weak
 * Topics with fewer than MIN_ATTEMPTS answers have "insufficient data": no colour, not ranked.
 */
import { TopicStat } from '../types/dashboard';

export const MIN_ATTEMPTS = 5;
export const WEAK_BELOW = 0.5; // mastery < 0.5  -> amber
export const STRONG_FROM = 0.7; // mastery >= 0.7 -> strong teal (0.5 to 0.7 -> light teal)

export type MasteryTone = 'insufficient' | 'amber' | 'light-teal' | 'strong-teal';

/** Words for each tone, so colour is never the only signal. */
export const TONE_LABEL: Record<MasteryTone, string> = {
  insufficient: 'Insufficient data',
  amber: 'Weak',
  'light-teal': 'Fair',
  'strong-teal': 'Strong',
};

export function hasEnoughData(topic: Pick<TopicStat, 'attempts'>): boolean {
  return topic.attempts >= MIN_ATTEMPTS;
}

/** THE colour rule for a mastery tile (the only place it is decided). */
export function masteryTone(topic: Pick<TopicStat, 'mastery' | 'attempts'>): MasteryTone {
  if (!hasEnoughData(topic)) return 'insufficient';
  if (topic.mastery < WEAK_BELOW) return 'amber';
  if (topic.mastery < STRONG_FROM) return 'light-teal';
  return 'strong-teal';
}

/** P_t = w_t * (1 - M_t) */
export function priority(topic: Pick<TopicStat, 'weightage' | 'mastery'>): number {
  return topic.weightage * (1 - topic.mastery);
}

/** The `count` topics to study first: highest P_t, leaving out topics with too little data. */
export function topPriorities(topics: TopicStat[], count: number): TopicStat[] {
  return topics
    .filter(hasEnoughData)
    .sort((a, b) => priority(b) - priority(a))
    .slice(0, count);
}

/** A one-line reason under a priority, e.g. "Heavily tested, mastery low". */
export function priorityReason(topic: TopicStat): string {
  const tested = topic.weightage >= 0.025 ? 'Heavily tested' : 'Moderately tested';
  const mastery = topic.mastery < WEAK_BELOW ? 'mastery low' : 'mastery fair';
  return `${tested}, ${mastery}`;
}

/** Every topic with enough data, highest priority first (the dashboard's priorities table). */
export function rankedTopics(topics: TopicStat[]): TopicStat[] {
  return topPriorities(topics, topics.length);
}

/** Topics practised too little to be ranked yet (fewer than MIN_ATTEMPTS answers). */
export function unrankedTopics(topics: TopicStat[]): TopicStat[] {
  return topics.filter((t) => !hasEnoughData(t));
}

/** Weak topics: enough data and mastery below WEAK_BELOW. */
export function weakTopics(topics: TopicStat[]): TopicStat[] {
  return topics.filter((t) => masteryTone(t) === 'amber');
}

/** The ranked topic with the highest mastery, or null. */
export function strongestTopic(topics: TopicStat[]): TopicStat | null {
  return topics.filter(hasEnoughData).reduce<TopicStat | null>((best, t) => (!best || t.mastery > best.mastery ? t : best), null);
}

/** Average mastery per subject, over its topics with enough data (subjects with none are left out). */
export function subjectAverages(topics: TopicStat[]): { subject: TopicStat['subject']; mastery: number; topics: number }[] {
  const subjects: TopicStat['subject'][] = ['Biology', 'Chemistry', 'Physics'];
  return subjects
    .map((subject) => {
      const own = topics.filter((t) => t.subject === subject && hasEnoughData(t));
      const mastery = own.length ? own.reduce((sum, t) => sum + t.mastery, 0) / own.length : 0;
      return { subject, mastery, topics: own.length };
    })
    .filter((s) => s.topics > 0);
}
