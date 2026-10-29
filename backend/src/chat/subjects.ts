/**
 * The chat page names subjects "biology" | "chemistry" | "physics"; the subjects collection
 * stores them by code (set by rag-service ingestion: rag-service/config.py SUBJECTS).
 */
export const SUBJECT_CODES = { biology: 'BIO', chemistry: 'CHEM', physics: 'PHY' } as const;
export type SubjectKey = keyof typeof SUBJECT_CODES;
export const SUBJECT_KEYS = Object.keys(SUBJECT_CODES) as SubjectKey[];

export function subjectKeyForCode(code: string | undefined): SubjectKey | null {
  return SUBJECT_KEYS.find((key) => SUBJECT_CODES[key] === code) ?? null;
}
