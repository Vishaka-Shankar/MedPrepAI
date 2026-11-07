import { ChatMessage, SubjectFilter, SubjectId } from '../api/chatTypes';

/**
 * The subject of a cited textbook, from its file name:
 * "STBB_Chemistry_X.pdf" -> "chemistry". The MDCAT syllabus and past papers cover every subject -> null.
 */
export function bookSubject(file: string): SubjectId | null {
  const match = file.match(/^STBB_(Biology|Chemistry|Physics)_/i);
  return match ? (match[1].toLowerCase() as SubjectId) : null;
}

/**
 * The subjects a question belongs to, for the subject filter:
 * - asked with a subject selected -> that subject;
 * - asked under "All" -> the subjects of the textbooks its answer cites
 *   (a refused question cites nothing, so it is only shown under "All").
 */
export function messageSubjects(message: ChatMessage): SubjectId[] {
  if (message.subjectId) return [message.subjectId];
  const subjects = message.citations.map((c) => bookSubject(c.source)).filter((s): s is SubjectId => s !== null);
  return [...new Set(subjects)];
}

/** True if the message should be shown while `filter` is selected. */
export function matchesFilter(message: ChatMessage, filter: SubjectFilter): boolean {
  return filter === 'all' || messageSubjects(message).includes(filter);
}
