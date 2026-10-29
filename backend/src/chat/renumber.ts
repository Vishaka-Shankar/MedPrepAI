import { RagCitation } from './rag-client';

/**
 * The chat page links [n] in the answer to the n-th citation in the list, so the numbers must be
 * 1, 2, 3... in list order. The rag-service numbers the passages it sent to the LLM, and the answer
 * may cite only some of them (e.g. [3] and [4]). This renumbers both the text and the list:
 * "...[3] ... [4][3]" with citations 3, 4 -> "...[1] ... [2][1]" with citations 1, 2.
 * "[1, 2]" becomes "[1][2]", because the chat page only links single numbers.
 */
export function renumberCitations(answer: string, citations: RagCitation[]): { answer: string; citations: RagCitation[] } {
  const ordered = [...citations].sort((a, b) => a.n - b.n);
  const newNumber = new Map(ordered.map((c, i) => [c.n, i + 1]));
  const text = answer.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (whole, numbers: string) => {
    const mapped = numbers
      .split(/\s*,\s*/)
      .map((n) => newNumber.get(Number(n)))
      .filter((n): n is number => n !== undefined);
    // The rag-service already removed numbers it never sent; drop any that are still unknown
    return mapped.map((n) => `[${n}]`).join('');
  });
  return { answer: text.replace(/[ \t]+([.,;:!?])/g, '$1').trim(), citations: ordered.map((c, i) => ({ ...c, n: i + 1 })) };
}
