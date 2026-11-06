import { describe, expect, it } from 'vitest';
import { MOCK_DASHBOARD } from '../mocks/dashboard';
import { TopicStat } from '../types/dashboard';
import {
  hasEnoughData,
  masteryTone,
  priority,
  priorityReason,
  rankedTopics,
  strongestTopic,
  subjectAverages,
  topPriorities,
  unrankedTopics,
  weakTopics,
} from './mastery';

const topic = (name: string, weightage: number, mastery: number, attempts = 10): TopicStat => ({
  subject: 'Biology',
  name,
  weightage,
  mastery,
  attempts,
});

describe('masteryTone (tile colour rule)', () => {
  it('is amber below 0.5', () => {
    expect(masteryTone({ mastery: 0, attempts: 10 })).toBe('amber');
    expect(masteryTone({ mastery: 0.49, attempts: 10 })).toBe('amber');
    expect(masteryTone({ mastery: 0.4999, attempts: 10 })).toBe('amber');
  });

  it('is light teal from exactly 0.5 up to just below 0.7', () => {
    expect(masteryTone({ mastery: 0.5, attempts: 10 })).toBe('light-teal'); // boundary
    expect(masteryTone({ mastery: 0.6, attempts: 10 })).toBe('light-teal');
    expect(masteryTone({ mastery: 0.6999, attempts: 10 })).toBe('light-teal');
  });

  it('is strong teal from exactly 0.7', () => {
    expect(masteryTone({ mastery: 0.7, attempts: 10 })).toBe('strong-teal'); // boundary
    expect(masteryTone({ mastery: 1, attempts: 10 })).toBe('strong-teal');
  });
});

describe('insufficient-data rule (fewer than 5 attempts)', () => {
  it('needs at least 5 attempts', () => {
    expect(hasEnoughData({ attempts: 4 })).toBe(false);
    expect(hasEnoughData({ attempts: 5 })).toBe(true); // boundary
  });

  it('shows "insufficient" whatever the mastery value', () => {
    expect(masteryTone({ mastery: 0.1, attempts: 4 })).toBe('insufficient');
    expect(masteryTone({ mastery: 0.9, attempts: 0 })).toBe('insufficient');
    expect(masteryTone({ mastery: 0.1, attempts: 5 })).toBe('amber');
  });

  it('leaves such topics out of the priorities, even with the highest P', () => {
    const ranked = topPriorities([topic('Genetics', 0.05, 0.1, 4), topic('Cell biology', 0.03, 0.4)], 3);
    expect(ranked.map((t) => t.name)).toEqual(['Cell biology']);
  });
});

describe('priority P = weightage x (1 - mastery)', () => {
  it('computes the formula', () => {
    expect(priority({ weightage: 0.03, mastery: 0.4 })).toBeCloseTo(0.018);
    expect(priority({ weightage: 0.02, mastery: 1 })).toBe(0); // fully mastered: no priority
    expect(priority({ weightage: 0.02, mastery: 0 })).toBeCloseTo(0.02); // unknown topic: its full weight
  });

  it('ranks the highest P first and keeps only the top N', () => {
    const ranked = topPriorities(
      [topic('Kinematics', 0.025, 0.7), topic('Cell biology', 0.03, 0.4), topic('Equilibrium', 0.025, 0.35)],
      2,
    );
    expect(ranked.map((t) => t.name)).toEqual(['Cell biology', 'Equilibrium']);
  });

  it('gives the expected top 3 for the mock dashboard data', () => {
    const ranked = topPriorities(MOCK_DASHBOARD.topics, 3);
    expect(ranked.map((t) => [t.name, Number(priority(t).toFixed(3))])).toEqual([
      ['Cell biology', 0.018],
      ['Equilibrium', 0.016],
      ['Electrostatics', 0.011],
    ]);
  });

  it('explains a priority in one line', () => {
    expect(priorityReason(topic('x', 0.03, 0.4))).toBe('Heavily tested, mastery low');
    expect(priorityReason(topic('y', 0.02, 0.45))).toBe('Moderately tested, mastery low');
  });
});

describe('dashboard summaries', () => {
  const t = (subject: TopicStat['subject'], name: string, weightage: number, mastery: number, attempts: number): TopicStat => ({
    subject,
    name,
    weightage,
    mastery,
    attempts,
  });
  const topics = [
    t('Biology', 'Cell biology', 0.03, 0.4, 18),
    t('Biology', 'Genetics', 0.03, 0.5, 2), // too few attempts
    t('Biology', 'Enzymes', 0.03, 0.72, 12),
    t('Chemistry', 'Equilibrium', 0.025, 0.35, 14),
    t('Chemistry', 'Atomic structure', 0.02, 0.8, 10),
  ];

  it('ranks every topic with enough data by priority and lists the rest separately', () => {
    expect(rankedTopics(topics).map((x) => x.name)).toEqual(['Cell biology', 'Equilibrium', 'Enzymes', 'Atomic structure']);
    expect(unrankedTopics(topics).map((x) => x.name)).toEqual(['Genetics']);
  });

  it('counts weak topics and finds the strongest one', () => {
    expect(weakTopics(topics).map((x) => x.name)).toEqual(['Cell biology', 'Equilibrium']);
    expect(strongestTopic(topics)?.name).toBe('Atomic structure');
    expect(strongestTopic([])).toBeNull();
  });

  it('averages mastery per subject over its ranked topics only', () => {
    const [bio, chem] = subjectAverages(topics);
    expect(bio.subject).toBe('Biology');
    expect(bio.mastery).toBeCloseTo(0.56); // (0.40 + 0.72) / 2, Genetics left out
    expect(bio.topics).toBe(2);
    expect(chem.mastery).toBeCloseTo(0.575);
    expect(subjectAverages(topics)).toHaveLength(2); // no Physics topics: left out
  });
});
