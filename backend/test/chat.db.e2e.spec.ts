/**
 * Chat end to end: the real AppModule (JWT guard, ValidationPipe, Mongoose) against a throwaway
 * MongoDB, with the rag-service replaced by a fake (the live service is checked by hand, see README).
 */
import { INestApplication, Logger } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { configureApp } from '../src/app.setup';
import { HISTORY_LIMIT, UNKNOWN_SOURCE } from '../src/chat/chat.service';
import { RAG_DOWN, RagAnswer, RagAnswerRequest, RagClient, RagUnavailableError } from '../src/chat/rag-client';
import { ChatMessage } from '../src/schemas/chat-message.schema';
import { Citation } from '../src/schemas/citation.schema';
import { User } from '../src/schemas/user.schema';

jest.setTimeout(120_000); // the first run downloads a MongoDB binary

const PASSWORD = 'Secret123';
const OUT_OF_SCOPE = "I couldn't find this in the syllabus material. Try rephrasing, or pick a subject.";

/** Stands in for the rag-service: returns the queued answer (or throws), records every request. */
class FakeRag {
  calls: RagAnswerRequest[] = [];
  next: RagAnswer | Error = { status: 'out_of_scope', answer: OUT_OF_SCOPE, citations: [] };
  answer(req: RagAnswerRequest): Promise<RagAnswer> {
    this.calls.push(req);
    return this.next instanceof Error ? Promise.reject(this.next) : Promise.resolve(this.next);
  }
}

describe('chat: /chat/ask and /chat/history against a real MongoDB (e2e)', () => {
  let mongo: MongoMemoryServer;
  let app: INestApplication;
  let db: Connection;
  let users: Model<User>;
  let messages: Model<ChatMessage>;
  let citations: Model<Citation>;
  const rag = new FakeRag();
  const ids = { bio: new Types.ObjectId(), phy: new Types.ObjectId(), book: new Types.ObjectId(), c63: new Types.ObjectId(), c74: new Types.ObjectId() };

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongo.getUri('medprep_chat_e2e');
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(RagClient).useValue(rag).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app, 'http://localhost:5173');
    await app.init();
    db = app.get<Connection>(getConnectionToken());
    users = db.model<User>('User');
    messages = db.model<ChatMessage>('ChatMessage');
    citations = db.model<Citation>('Citation');
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    // What ingestion stored: subjects, one book, two of its chunks
    await db.collection('subjects').insertMany([
      { _id: ids.bio, code: 'BIO', name: 'Biology', weightShare: 0.34 },
      { _id: ids.phy, code: 'PHY', name: 'Physics', weightShare: 0.27 },
    ]);
    await db.collection('source_documents').insertOne({ _id: ids.book, source: 'STBB_Physics_XI.pdf', type: 'textbook' });
    await db.collection('chunks').insertMany([
      { _id: ids.c63, docId: ids.book, subjectId: ids.phy, page: 63, text: 'Newton second law...' },
      { _id: ids.c74, docId: ids.book, subjectId: ids.phy, page: 74, text: 'F = ma...' },
    ]);
  });

  beforeEach(async () => {
    for (const name of ['users', 'chat_messages', 'citations']) await db.collection(name).deleteMany({});
    rag.calls = [];
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
    await mongo?.stop();
  });

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function student(name: string, email: string): Promise<{ id: string; token: string }> {
    const user = await users.create({ name, email, passwordHash: await bcrypt.hash(PASSWORD, 10), role: 'student', emailVerified: true });
    const res = await http().post('/auth/login').send({ email, password: PASSWORD });
    return { id: user.id as string, token: res.body.accessToken as string };
  }

  const newtonAnswer = (): RagAnswer => ({
    status: 'ok',
    answer: 'Acceleration is proportional to the net force [3][4]. F = ma [4].',
    citations: [
      { n: 3, chunkId: ids.c63.toString(), source: 'STBB_Physics_XI.pdf', page: 63, snippet: 'Newton second law...' },
      { n: 4, chunkId: ids.c74.toString(), source: 'STBB_Physics_XI.pdf', page: 74, snippet: 'F = ma...' },
    ],
  });

  describe('auth required', () => {
    it('both routes refuse a request without a token, and nothing is saved or asked', async () => {
      expect((await http().post('/chat/ask').send({ question: 'Newton?' })).status).toBe(401);
      expect((await http().get('/chat/history')).status).toBe(401);
      expect((await http().get('/chat/history').set(auth('not.a.token'))).status).toBe(401);
      expect(await messages.countDocuments()).toBe(0);
      expect(rag.calls).toEqual([]);
    });
  });

  describe('POST /chat/ask', () => {
    it('saves the question, the answer and one citation per source, renumbered [1], [2]', async () => {
      const me = await student('Ayesha Khan', 'ayesha@example.com');
      rag.next = newtonAnswer();
      const res = await http().post('/chat/ask').set(auth(me.token)).send({ question: "  State Newton's second law.  ", subjectId: 'physics' });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        question: "State Newton's second law.",
        subjectId: 'physics',
        answer: 'Acceleration is proportional to the net force [1][2]. F = ma [2].',
        refused: false,
        citations: [
          { source: 'STBB_Physics_XI.pdf', page: 63, snippet: 'Newton second law...' },
          { source: 'STBB_Physics_XI.pdf', page: 74, snippet: 'F = ma...' },
        ],
      });
      expect(rag.calls).toEqual([{ question: "State Newton's second law.", subjectId: ids.phy.toString() }]);

      const saved = await messages.findById(res.body.id).lean();
      expect(saved).toMatchObject({ question: "State Newton's second law.", inputMode: 'text', status: 'answered', outOfScope: false });
      expect(saved?.userId.toString()).toBe(me.id);
      expect(saved?.subjectId?.toString()).toBe(ids.phy.toString());
      expect(saved?.answer).toBe(res.body.answer);
      const rows = await citations.find({ chatMessageId: saved?._id }).sort({ _id: 1 }).lean();
      expect(rows.map((c) => [c.chunkId.toString(), c.page, c.snippet])).toEqual([
        [ids.c63.toString(), 63, 'Newton second law...'],
        [ids.c74.toString(), 74, 'F = ma...'],
      ]);
    });

    it('out of scope: saved as answered + outOfScope, no citations, refused: true', async () => {
      const me = await student('Ayesha Khan', 'ayesha@example.com');
      rag.next = { status: 'out_of_scope', answer: OUT_OF_SCOPE, citations: [] };
      const res = await http().post('/chat/ask').set(auth(me.token)).send({ question: 'Who won the cricket world cup?', subjectId: null });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ subjectId: null, answer: OUT_OF_SCOPE, refused: true, citations: [] });
      expect(rag.calls).toEqual([{ question: 'Who won the cricket world cup?' }]); // no subject filter
      expect(await messages.findById(res.body.id).lean()).toMatchObject({ status: 'answered', outOfScope: true, subjectId: null });
      expect(await citations.countDocuments()).toBe(0);
    });

    it('rag-service down: 503 RAG_UNAVAILABLE with a clear message, the question is kept as failed', async () => {
      const me = await student('Ayesha Khan', 'ayesha@example.com');
      rag.next = new RagUnavailableError(RAG_DOWN);
      const res = await http().post('/chat/ask').set(auth(me.token)).send({ question: 'How do enzymes work?' });

      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ code: 'RAG_UNAVAILABLE', message: RAG_DOWN });
      expect(await messages.findOne().lean()).toMatchObject({ status: 'failed', question: 'How do enzymes work?' });
      expect(await citations.countDocuments()).toBe(0);
    });

    it('AI key missing: 503 AI_NOT_CONFIGURED with the rag-service sentence', async () => {
      const me = await student('Ayesha Khan', 'ayesha@example.com');
      const sentence = 'The AI tutor is not set up yet: GROQ_API_KEY is empty in the .env file. Please ask the administrator to add it.';
      rag.next = { status: 'error', code: 'LLM_NOT_CONFIGURED', answer: sentence, citations: [] };
      const res = await http().post('/chat/ask').set(auth(me.token)).send({ question: 'How do enzymes work?' });
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ code: 'AI_NOT_CONFIGURED', message: sentence });

      rag.next = { status: 'error', code: 'LLM_UNAVAILABLE', answer: 'The AI tutor took too long to answer.', citations: [] };
      const slow = await http().post('/chat/ask').set(auth(me.token)).send({ question: 'How do enzymes work?' });
      expect(slow.body).toMatchObject({ code: 'AI_UNAVAILABLE', message: 'The AI tutor took too long to answer.' });
      expect(await messages.countDocuments({ status: 'failed' })).toBe(2);
    });

    it.each([
      [{ question: '   ' }, 'Please type a question'],
      [{ question: 'x'.repeat(1001) }, 'at most 1000 characters'],
      [{ question: 'Newton?', subjectId: 'math' }, 'subjectId must be one of: biology, chemistry, physics'],
      [{ question: 'Newton?', userId: new Types.ObjectId().toString() }, 'property userId should not exist'],
      [{}, 'question must be text'],
    ])('rejects %j with 400 before asking the rag-service', async (body, message) => {
      const me = await student('Ayesha Khan', 'ayesha@example.com');
      const res = await http().post('/chat/ask').set(auth(me.token)).send(body);
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.message)).toContain(message);
      expect(rag.calls).toEqual([]);
      expect(await messages.countDocuments()).toBe(0);
    });
  });

  describe('GET /chat/history', () => {
    it("returns only the logged-in user's answered messages, oldest first, with citations and sources", async () => {
      const ayesha = await student('Ayesha Khan', 'ayesha@example.com');
      const bilal = await student('Bilal Ahmed', 'bilal@example.com');

      rag.next = newtonAnswer();
      await http().post('/chat/ask').set(auth(ayesha.token)).send({ question: 'Newton second law?', subjectId: 'physics' });
      rag.next = { status: 'out_of_scope', answer: OUT_OF_SCOPE, citations: [] };
      await http().post('/chat/ask').set(auth(ayesha.token)).send({ question: 'Cricket?' });
      rag.next = new RagUnavailableError(RAG_DOWN);
      await http().post('/chat/ask').set(auth(ayesha.token)).send({ question: 'This one failed' });
      rag.next = newtonAnswer();
      await http().post('/chat/ask').set(auth(bilal.token)).send({ question: "Bilal's private question" });

      const mine = await http().get('/chat/history').set(auth(ayesha.token));
      expect(mine.status).toBe(200);
      expect(mine.body.map((m: { question: string }) => m.question)).toEqual(['Newton second law?', 'Cricket?']);
      expect(mine.body[0]).toMatchObject({
        subjectId: 'physics',
        refused: false,
        answer: 'Acceleration is proportional to the net force [1][2]. F = ma [2].',
        citations: [
          { source: 'STBB_Physics_XI.pdf', page: 63, snippet: 'Newton second law...' },
          { source: 'STBB_Physics_XI.pdf', page: 74, snippet: 'F = ma...' },
        ],
      });
      expect(mine.body[1]).toMatchObject({ subjectId: null, refused: true, citations: [] });

      const his = await http().get('/chat/history').set(auth(bilal.token));
      expect(his.body.map((m: { question: string }) => m.question)).toEqual(["Bilal's private question"]);
      expect(JSON.stringify(his.body)).not.toContain('Newton second law?');
    });

    it('a citation whose chunk was deleted still shows, as "Unknown source"', async () => {
      const me = await student('Ayesha Khan', 'ayesha@example.com');
      const message = await messages.create({ userId: new Types.ObjectId(me.id), question: 'Old question', status: 'answered', answer: 'Old [1].' });
      await citations.create({ chatMessageId: message._id, chunkId: new Types.ObjectId(), page: 5, snippet: 'gone' });
      const res = await http().get('/chat/history').set(auth(me.token));
      expect(res.body[0].citations).toEqual([{ source: UNKNOWN_SOURCE, page: 5, snippet: 'gone' }]);
    });

    it(`returns at most the newest ${HISTORY_LIMIT}, still oldest first`, async () => {
      const me = await student('Ayesha Khan', 'ayesha@example.com');
      const userId = new Types.ObjectId(me.id);
      const base = Date.UTC(2026, 9, 1);
      await messages.insertMany(
        Array.from({ length: HISTORY_LIMIT + 5 }, (_, i) => ({
          userId,
          question: `Q${i}`,
          status: 'answered',
          answer: 'A',
          createdAt: new Date(base + i * 1000),
          updatedAt: new Date(base + i * 1000),
        })),
        { timestamps: false } as never,
      );
      const res = await http().get('/chat/history').set(auth(me.token));
      expect(res.body).toHaveLength(HISTORY_LIMIT);
      expect(res.body[0].question).toBe('Q5');
      expect(res.body[HISTORY_LIMIT - 1].question).toBe(`Q${HISTORY_LIMIT + 4}`);
    });
  });

  it('deleting the account removes the chat and its citations (existing account delete)', async () => {
    const me = await student('Ayesha Khan', 'ayesha@example.com');
    rag.next = newtonAnswer();
    await http().post('/chat/ask').set(auth(me.token)).send({ question: 'Newton?' });
    expect(await citations.countDocuments()).toBe(2);
    const res = await http().delete('/users/me').set(auth(me.token)).send({ password: PASSWORD });
    expect(res.status).toBe(200);
    expect(await messages.countDocuments()).toBe(0);
    expect(await citations.countDocuments()).toBe(0);
  });
});
