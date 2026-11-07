import { describe, expect, it } from 'vitest';
import { answerAsText, sourceLabel } from './ChatMessageView';

describe('sourceLabel (readable book names in citation cards)', () => {
  it('names the STBB textbooks like students do', () => {
    expect(sourceLabel('STBB_Biology_XI.pdf')).toBe('Biology XI');
    expect(sourceLabel('STBB_Chemistry_XII.pdf')).toBe('Chemistry XII');
    expect(sourceLabel('STBB_Physics_IX.pdf')).toBe('Physics IX'); // grades 9 and 10, added 2026-11-04
    expect(sourceLabel('STBB_Chemistry_X.pdf')).toBe('Chemistry X');
  });

  it('names the MDCAT syllabus and past papers', () => {
    expect(sourceLabel('PMDC_MDCAT_Curriculum_2025_Final.pdf')).toBe('MDCAT syllabus');
    expect(sourceLabel('SZABMU_MDCAT_2024_Paper_Blue.pdf')).toBe('MDCAT 2024 past paper');
  });

  it('falls back to the file name without underscores', () => {
    expect(sourceLabel('Some_New_Book.pdf')).toBe('Some New Book');
  });
});

describe('answerAsText (Copy answer)', () => {
  it('adds the sources under the answer', () => {
    const text = answerAsText({
      id: 'm1',
      question: 'q',
      subjectId: null,
      answer: 'Neutralization gives salt and water [1].',
      refused: false,
      citations: [{ source: 'STBB_Chemistry_X.pdf', page: 34, snippet: 's' }],
      createdAt: '2026-11-06T10:00:00.000Z',
    });
    expect(text).toBe('Neutralization gives salt and water [1].\n\nSources:\n[1] Chemistry X, page 34');
  });
});
