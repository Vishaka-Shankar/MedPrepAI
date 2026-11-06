import { describe, expect, it } from 'vitest';
import { SUGGESTION_POOL, pickSuggestions, seededRandom, shuffled } from './suggestions';

describe('pickSuggestions', () => {
  it('picks 3 questions from the selected subject only', () => {
    const picks = pickSuggestions('physics', 0.42);
    expect(picks).toHaveLength(3);
    for (const q of picks) expect(SUGGESTION_POOL.physics).toContain(q);
    expect(new Set(picks).size).toBe(3); // no repeats
  });

  it('gives "All" one question from each subject', () => {
    const [bio, chem, phy] = pickSuggestions('all', 0.42);
    expect(SUGGESTION_POOL.biology).toContain(bio);
    expect(SUGGESTION_POOL.chemistry).toContain(chem);
    expect(SUGGESTION_POOL.physics).toContain(phy);
  });

  it('keeps the same picks for the same seed (the chips stay still during a visit)', () => {
    expect(pickSuggestions('biology', 0.42)).toEqual(pickSuggestions('biology', 0.42));
  });

  it('changes the picks from visit to visit (a new seed each time)', () => {
    const seen = new Set<string>();
    for (const seed of [0.05, 0.25, 0.45, 0.65, 0.85]) pickSuggestions('chemistry', seed).forEach((q) => seen.add(q));
    expect(seen.size).toBeGreaterThan(3); // more than one fixed set of three
  });

  it('leaves out questions already asked, and the next one takes their place', () => {
    const before = pickSuggestions('biology', 0.42);
    const after = pickSuggestions('biology', 0.42, [` ${before[0].toUpperCase()} `]); // case and spaces ignored
    expect(after).not.toContain(before[0]);
    expect(after.slice(0, 2)).toEqual(before.slice(1)); // the others stay in place
    expect(after).toHaveLength(3);
  });

  it('shows fewer when almost everything has been asked', () => {
    const asked = SUGGESTION_POOL.physics.slice(1);
    expect(pickSuggestions('physics', 0.42, asked)).toEqual([SUGGESTION_POOL.physics[0]]);
  });
});

describe('shuffled', () => {
  it('returns the same items in a new order without changing the input', () => {
    const items = [1, 2, 3, 4, 5, 6];
    const out = shuffled(items, seededRandom(0.3));
    expect([...out].sort()).toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
