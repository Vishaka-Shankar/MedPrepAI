import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ChatMessage } from '../schemas/chat-message.schema';
import { Chunk } from '../schemas/chunk.schema';
import { Citation } from '../schemas/citation.schema';
import { SourceDocument } from '../schemas/source-document.schema';
import { Subject } from '../schemas/subject.schema';
import { AskDto } from './dto/ask.dto';
import { RagClient, RagUnavailableError } from './rag-client';
import { renumberCitations } from './renumber';
import { SUBJECT_CODES, SubjectKey, subjectKeyForCode } from './subjects';

/** What the chat page receives (frontend/src/api/chatTypes.ts ChatMessage). */
export interface ChatMessageView {
  id: string;
  question: string;
  subjectId: SubjectKey | null;
  answer: string;
  refused: boolean;
  citations: { source: string; page: number | null; snippet: string }[];
  createdAt: string;
}

export const HISTORY_LIMIT = 50; // the newest 50 questions, shown oldest first
export const UNKNOWN_SOURCE = 'Unknown source';
export const SUBJECTS_MISSING = 'Subjects are not set up in the database yet. Please try "All subjects".';

/** 503 with a machine-readable code, like the other errors the frontend reacts to. */
function unavailable(code: string, message: string): ServiceUnavailableException {
  return new ServiceUnavailableException({ statusCode: 503, code, message });
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectModel(ChatMessage.name) private readonly messages: Model<ChatMessage>,
    @InjectModel(Citation.name) private readonly citations: Model<Citation>,
    @InjectModel(Subject.name) private readonly subjects: Model<Subject>,
    @InjectModel(Chunk.name) private readonly chunks: Model<Chunk>,
    @InjectModel(SourceDocument.name) private readonly documents: Model<SourceDocument>,
    private readonly rag: RagClient,
  ) {}

  /**
   * Ask a question: save it as "pending", get the answer from the rag-service, then save the
   * answer and one citation row per source. If no answer can be had, the question is kept as
   * "failed" (not shown in the history) and the user gets a 503 with the reason.
   */
  async ask(userId: string, dto: AskDto): Promise<ChatMessageView> {
    const subjectKey = dto.subjectId ?? null;
    const subjectId = subjectKey ? await this.subjectIdFor(subjectKey) : null;
    const message = await this.messages.create({
      userId: new Types.ObjectId(userId),
      question: dto.question,
      inputMode: 'text',
      status: 'pending',
      subjectId,
    });

    let rag;
    try {
      rag = await this.rag.answer({ question: dto.question, ...(subjectId ? { subjectId: subjectId.toString() } : {}) });
    } catch (err) {
      await this.messages.updateOne({ _id: message._id }, { status: 'failed' });
      if (err instanceof RagUnavailableError) throw unavailable('RAG_UNAVAILABLE', err.message);
      throw err;
    }

    if (rag.status === 'error') {
      await this.messages.updateOne({ _id: message._id }, { status: 'failed' });
      this.logger.warn(`AI answer failed: ${rag.code}`);
      throw unavailable(rag.code === 'LLM_NOT_CONFIGURED' ? 'AI_NOT_CONFIGURED' : 'AI_UNAVAILABLE', rag.answer);
    }

    const outOfScope = rag.status === 'out_of_scope';
    const { answer, citations } = outOfScope ? { answer: rag.answer, citations: [] } : renumberCitations(rag.answer, rag.citations);
    if (citations.length > 0) {
      // Inserted in [n] order: history reads them back sorted by _id
      await this.citations.insertMany(
        citations.map((c) => ({
          chatMessageId: message._id,
          chunkId: new Types.ObjectId(c.chunkId),
          page: c.page ?? undefined,
          snippet: c.snippet,
        })),
      );
    }
    await this.messages.updateOne({ _id: message._id }, { status: 'answered', answer, outOfScope });

    return {
      id: message.id as string,
      question: message.question,
      subjectId: subjectKey,
      answer,
      refused: outOfScope,
      citations: citations.map((c) => ({ source: c.source, page: c.page ?? null, snippet: c.snippet })),
      createdAt: (message as unknown as { createdAt: Date }).createdAt.toISOString(),
    };
  }

  /** The user's answered questions (newest HISTORY_LIMIT), oldest first, with their citations. */
  async history(userId: string): Promise<ChatMessageView[]> {
    const rows = await this.messages
      .find({ userId: new Types.ObjectId(userId), status: 'answered' })
      .sort({ createdAt: -1, _id: -1 })
      .limit(HISTORY_LIMIT)
      .lean<(ChatMessage & { _id: Types.ObjectId; createdAt: Date })[]>();
    rows.reverse();
    if (rows.length === 0) return [];

    const cites = await this.citations
      .find({ chatMessageId: { $in: rows.map((r) => r._id) } })
      .sort({ _id: 1 })
      .lean<(Citation & { _id: Types.ObjectId })[]>();
    const sources = await this.sourcesFor(cites.map((c) => c.chunkId));
    const subjectKeys = await this.subjectKeysFor(rows.map((r) => r.subjectId).filter((id): id is Types.ObjectId => !!id));

    return rows.map((r) => ({
      id: r._id.toString(),
      question: r.question,
      subjectId: r.subjectId ? (subjectKeys.get(r.subjectId.toString()) ?? null) : null,
      answer: r.answer ?? '',
      refused: r.outOfScope === true,
      citations: cites
        .filter((c) => c.chatMessageId.equals(r._id))
        .map((c) => ({ source: sources.get(c.chunkId.toString()) ?? UNKNOWN_SOURCE, page: c.page ?? null, snippet: c.snippet })),
      createdAt: r.createdAt.toISOString(),
    }));
  }

  private async subjectIdFor(key: SubjectKey): Promise<Types.ObjectId> {
    const subject = await this.subjects.findOne({ code: SUBJECT_CODES[key] }, { _id: 1 }).lean<{ _id: Types.ObjectId }>();
    if (!subject) throw unavailable('SUBJECTS_MISSING', SUBJECTS_MISSING);
    return subject._id;
  }

  /** chunkId -> source file name (chunk -> source_document). A deleted chunk gets UNKNOWN_SOURCE. */
  private async sourcesFor(chunkIds: Types.ObjectId[]): Promise<Map<string, string>> {
    if (chunkIds.length === 0) return new Map();
    const chunks = await this.chunks.find({ _id: { $in: chunkIds } }, { docId: 1 }).lean<{ _id: Types.ObjectId; docId: Types.ObjectId }[]>();
    const docs = await this.documents
      .find({ _id: { $in: chunks.map((c) => c.docId) } }, { source: 1 })
      .lean<{ _id: Types.ObjectId; source: string }[]>();
    const docSource = new Map(docs.map((d) => [d._id.toString(), d.source]));
    return new Map(chunks.map((c) => [c._id.toString(), docSource.get(c.docId.toString()) ?? UNKNOWN_SOURCE]));
  }

  private async subjectKeysFor(ids: Types.ObjectId[]): Promise<Map<string, SubjectKey | null>> {
    if (ids.length === 0) return new Map();
    const subjects = await this.subjects.find({ _id: { $in: ids } }, { code: 1 }).lean<{ _id: Types.ObjectId; code: string }[]>();
    return new Map(subjects.map((s) => [s._id.toString(), subjectKeyForCode(s.code)]));
  }
}
