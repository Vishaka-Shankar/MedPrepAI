import { describe, expect, it } from 'vitest';
import { ChatMessage, Citation } from '../api/chatTypes';
import { bookSubject, matchesFilter, messageSubjects } from './chatSubjects';

const cite = (source: string): Citation => ({ source, page: 1, snippet: 'text' });

function message(subjectId: ChatMessage['subjectId'], sources: string[], refused = false): ChatMessage {
  return {
    id: 'm1',
    question: 'q',
    subjectId,
    answer: 'a',
    refused,
    citations: sources.map(cite),
    createdAt: '2026-11-06T10:00:00.000Z',
  };
}

describe('bookSubject', () => {
  it('reads the subject from all four years of STBB books', () => {
    expect(bookSubject('STBB_Biology_IX.pdf')).toBe('biology');
    expect(bookSubject('STBB_Chemistry_X.pdf')).toBe('chemistry');
    expect(bookSubject('STBB_Physics_XII.pdf')).toBe('physics');
  });

  it('gives no subject for the syllabus and past papers (they cover every subject)', () => {
    expect(bookSubject('PMDC_MDCAT_Curriculum_2025_Final.pdf')).toBeNull();
    expect(bookSubject('SZABMU_MDCAT_2024_Paper_Blue.pdf')).toBeNull();
  });
});

describe('messageSubjects', () => {
  it('uses the subject the question was asked with', () => {
    expect(messageSubjects(message('chemistry', ['STBB_Biology_XII.pdf']))).toEqual(['chemistry']);
  });

  it('uses the cited books for a question asked under "All"', () => {
    // The loop of Henle question from the screenshot: asked under All, answered from Biology XII
    expect(messageSubjects(message(null, ['STBB_Biology_XII.pdf', 'PMDC_MDCAT_Curriculum_2025_Final.pdf']))).toEqual([
      'biology',
    ]);
    expect(messageSubjects(message(null, ['STBB_Chemistry_X.pdf', 'STBB_Biology_IX.pdf', 'STBB_Chemistry_XI.pdf']))).toEqual([
      'chemistry',
      'biology',
    ]);
  });

  it('gives a refused question no subject', () => {
    expect(messageSubjects(message(null, [], true))).toEqual([]);
  });
});

describe('matchesFilter', () => {
  const henle = message(null, ['STBB_Biology_XII.pdf']);
  const refused = message(null, [], true);

  it('shows everything under "All"', () => {
    expect(matchesFilter(henle, 'all')).toBe(true);
    expect(matchesFilter(refused, 'all')).toBe(true);
  });

  it('shows a question only under its own subject', () => {
    expect(matchesFilter(henle, 'biology')).toBe(true);
    expect(matchesFilter(henle, 'chemistry')).toBe(false);
    expect(matchesFilter(henle, 'physics')).toBe(false);
    expect(matchesFilter(refused, 'biology')).toBe(false);
  });
});
