import { SubjectFilter, SubjectId } from '../api/chatTypes';

/**
 * Suggested questions for the chat page. Each one is answered by a page of the ingested STBB books
 * (grades 9-12). The page shows 3 at a time, picked at random each time it opens, so they change
 * from session to session. To add one: put it in the right list and check it with
 * `python -m app.search "the question" --subject <subject>` (it should print "Relevant: yes").
 */
export const SUGGESTION_POOL: Record<SubjectId, string[]> = {
  biology: [
    'What are the levels of organization of life?',
    'What are the main parts of the human digestive system?',
    'What is selective reabsorption in the kidney?',
    'What is the difference between mitosis and meiosis?',
    'How do enzymes speed up chemical reactions?',
    'What is the structure of DNA?',
    'How does the human heart pump blood?',
    'What are the functions of the cell membrane?',
    'Where does photosynthesis take place in a plant cell?',
    'How do antibodies protect the body?',
  ],
  chemistry: [
    'What is the difference between an element, a compound and a mixture?',
    'What are acids and bases and how are they neutralized?',
    'What is a limiting reactant?',
    'How is an ionic bond formed?',
    'What is the difference between exothermic and endothermic reactions?',
    'What are isotopes?',
    "What is Le Chatelier's principle?",
    'What factors affect the rate of a chemical reaction?',
    'What are oxidation and reduction?',
    'What is the pH scale?',
  ],
  physics: [
    'How do you write the mass of the Sun in scientific notation?',
    'How is sound produced and how does it travel?',
    'Why does taking more readings reduce uncertainty?',
    "What are Newton's laws of motion?",
    'What is the difference between speed and velocity?',
    "What is Ohm's law?",
    'What is the law of conservation of energy?',
    'What is simple harmonic motion?',
    'What is the difference between transverse and longitudinal waves?',
    'What is electromagnetic induction?',
  ],
};

export const SUGGESTIONS_SHOWN = 3;

/**
 * A random number generator that gives the same sequence for the same seed (mulberry32).
 * One seed per page visit keeps the chips still while you use the page; a new visit gets a new seed.
 */
export function seededRandom(seed: number): () => number {
  let a = Math.floor(seed * 2 ** 32) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A shuffled copy (Fisher-Yates), using `random` so the order can be repeated in tests. */
export function shuffled<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * The questions to suggest for a filter: 3 from the subject's list in a random order for this `seed`,
 * leaving out questions the student already asked (so an asked one is replaced by the next).
 * "All" gets one question per subject.
 */
export function pickSuggestions(filter: SubjectFilter, seed: number, asked: string[] = []): string[] {
  const done = new Set(asked.map((q) => q.trim().toLowerCase()));
  const fresh = (subject: SubjectId) =>
    shuffled(SUGGESTION_POOL[subject], seededRandom(seed)).filter((q) => !done.has(q.toLowerCase()));
  if (filter === 'all') {
    const subjects: SubjectId[] = ['biology', 'chemistry', 'physics'];
    return subjects.map((s) => fresh(s)[0]).filter((q): q is string => q !== undefined);
  }
  return fresh(filter).slice(0, SUGGESTIONS_SHOWN);
}
