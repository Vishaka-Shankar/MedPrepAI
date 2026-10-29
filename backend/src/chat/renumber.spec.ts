import { RagCitation } from './rag-client';
import { renumberCitations } from './renumber';

const cite = (n: number, page: number): RagCitation => ({ n, chunkId: `c${n}`, source: 'STBB_Physics_XI.pdf', page, snippet: `p${page}` });

describe('renumberCitations', () => {
  it('turns [3] and [4] into [1] and [2] in the text and the list', () => {
    const result = renumberCitations('Acceleration is proportional to force [3][4]. F = ma [4]. Unbalanced [3].', [cite(4, 74), cite(3, 63)]);
    expect(result.answer).toBe('Acceleration is proportional to force [1][2]. F = ma [2]. Unbalanced [1].');
    expect(result.citations.map((c) => [c.n, c.page])).toEqual([
      [1, 63],
      [2, 74],
    ]);
  });

  it('splits [1, 2] into [1][2], which the chat page can link', () => {
    expect(renumberCitations('Both [1, 2].', [cite(1, 5), cite(2, 6)]).answer).toBe('Both [1][2].');
  });

  it('drops a number with no citation and leaves an answer without citations alone', () => {
    expect(renumberCitations('Water moves [2] [5].', [cite(2, 9)]).answer).toBe('Water moves [1].');
    expect(renumberCitations('The material does not answer this.', [])).toEqual({ answer: 'The material does not answer this.', citations: [] });
  });
});
