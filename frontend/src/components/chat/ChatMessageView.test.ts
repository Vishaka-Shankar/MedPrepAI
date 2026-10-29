import { describe, expect, it } from 'vitest';
import { sourceLabel } from './ChatMessageView';

describe('sourceLabel (readable book names in citation cards)', () => {
  it('names the STBB textbooks like students do', () => {
    expect(sourceLabel('STBB_Biology_XI.pdf')).toBe('Biology XI');
    expect(sourceLabel('STBB_Chemistry_XII.pdf')).toBe('Chemistry XII');
  });

  it('names the MDCAT syllabus and past papers', () => {
    expect(sourceLabel('PMDC_MDCAT_Curriculum_2025_Final.pdf')).toBe('MDCAT syllabus');
    expect(sourceLabel('SZABMU_MDCAT_2024_Paper_Blue.pdf')).toBe('MDCAT 2024 past paper');
  });

  it('falls back to the file name without underscores', () => {
    expect(sourceLabel('Some_New_Book.pdf')).toBe('Some New Book');
  });
});
