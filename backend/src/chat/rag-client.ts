import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppEnv } from '../config/env';

/** POST /answer on the rag-service (rag-service/app/answer.py). */
export interface RagAnswerRequest {
  question: string;
  subjectId?: string; // ObjectId of the subject, as text
}

export interface RagCitation {
  n: number; // the [n] used in the answer text
  chunkId: string;
  source: string; // file name, e.g. STBB_Biology_XI.pdf
  page: number | null;
  snippet: string;
}

export type RagAnswer =
  | { status: 'ok'; answer: string; citations: RagCitation[] }
  | { status: 'out_of_scope'; answer: string; citations: [] }
  | { status: 'error'; code: 'LLM_NOT_CONFIGURED' | 'LLM_UNAVAILABLE'; answer: string; citations: [] };

/** The rag-service could not give an answer at all (not running, timed out, or failed). */
export class RagUnavailableError extends Error {}

export const RAG_DOWN =
  'The question-answering service is not running or cannot be reached. Please try again in a minute.';
export const RAG_TIMED_OUT = 'The question-answering service took too long to answer. Please try again.';

// The rag-service may load its model (~16 s) and wait for the LLM (20 s, one retry).
// Below the frontend's 60 s, so the user sees our message, not a browser timeout.
export const RAG_TIMEOUT_MS = 55_000;

@Injectable()
export class RagClient {
  private readonly logger = new Logger(RagClient.name);
  private readonly baseUrl: string;

  constructor(config: ConfigService<AppEnv, true>) {
    this.baseUrl = config.get('RAG_SERVICE_URL', { infer: true });
  }

  async answer(request: RagAnswerRequest, timeoutMs = RAG_TIMEOUT_MS): Promise<RagAnswer> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      this.logger.error(`rag-service ${timedOut ? 'timed out' : 'unreachable'} at ${this.baseUrl}: ${(err as Error).message}`);
      throw new RagUnavailableError(timedOut ? RAG_TIMED_OUT : RAG_DOWN);
    }

    if (!response.ok) {
      // 503 from the rag-service carries a sentence (database down, not enough memory)
      const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
      this.logger.error(`rag-service answered HTTP ${response.status}`);
      throw new RagUnavailableError(typeof body?.detail === 'string' ? body.detail : RAG_DOWN);
    }
    const body = (await response.json().catch(() => null)) as RagAnswer | null;
    if (!body || !['ok', 'out_of_scope', 'error'].includes(body.status) || typeof body.answer !== 'string') {
      this.logger.error('rag-service sent an answer in an unexpected shape');
      throw new RagUnavailableError(RAG_DOWN);
    }
    return body;
  }
}
