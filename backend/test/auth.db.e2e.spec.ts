/**
 * Auth with email OTP, end to end: the real AppModule (controllers, ValidationPipe, bcrypt,
 * Mongoose, OtpService, MailService in test mode) against a real, throwaway MongoDB
 * (mongodb-memory-server), so no Atlas connection and no real email are needed.
 * Codes are read from MailService.outbox, the way a user reads them from their inbox.
 */
import { INestApplication, Logger } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection } from 'mongoose';
import request from 'supertest';
import { configureApp } from '../src/app.setup';
import { INVALID_LOGIN, RESEND_MESSAGE } from '../src/auth/auth.service';
import { DATABASE_UNAVAILABLE_MESSAGE } from '../src/database/database-unavailable.filter';
import { EMAIL_SEND_FAILED, MailService } from '../src/mail/mail.service';

jest.setTimeout(120_000); // the first run downloads a MongoDB binary

const PASSWORD = 'Secret123';

describe('auth with email OTP against a real MongoDB (e2e)', () => {
  let mongo: MongoMemoryServer;
  let app: INestApplication;
  let db: Connection;
  let mail: MailService;
  const logLines: string[] = [];

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    // Set before AppModule is loaded: ConfigModule reads process.env first,
    // so the test database replaces the Atlas URI from ../.env
    process.env.MONGODB_URI = mongo.getUri('medprep_e2e');
    const { AppModule } = await import('../src/app.module');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app, 'http://localhost:5173'); // same pipes, filter and CORS as main.ts
    await app.init();

    db = app.get<Connection>(getConnectionToken());
    await db.model('User').syncIndexes(); // unique email, as `npm run db:setup` creates
    await db.model('OtpCode').syncIndexes(); // TTL index on expiresAt
    mail = app.get(MailService);

    // Capture every log line (to check reasons are logged and codes never are), and keep the output quiet
    for (const level of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logLines.push(String(args[0]));
      });
    }
  });

  beforeEach(async () => {
    await db.collection('users').deleteMany({});
    await db.collection('otp_codes').deleteMany({});
    mail.outbox.length = 0;
    logLines.length = 0;
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
    await mongo?.stop();
  });

  const http = () => request(app.getHttpServer());
  const register = (email: string) => http().post('/auth/register').send({ name: 'Ayesha Khan', email, password: PASSWORD });
  const verify = (email: string, code: string) => http().post('/auth/verify-otp').send({ email, code });
  const resend = (email: string) => http().post('/auth/resend-otp').send({ email });
  const login = (email: string, password = PASSWORD) => http().post('/auth/login').send({ email, password });

  /** The 6-digit code in the newest email to this address, as the user would read it. */
  function codeFor(email: string): string {
    const message = [...mail.outbox].reverse().find((m) => m.to === email);
    const code = message?.text.match(/\b(\d{6})\b/)?.[1];
    if (!code) throw new Error(`no code emailed to ${email}`);
    return code;
  }
  const otpRows = (email: string) => db.collection('otp_codes').find({ email }).toArray();
  const wrongCode = (code: string) => (code === '000000' ? '111111' : '000000');

  describe('register', () => {
    it('creates an unverified user, sends exactly one email with the code, and returns no token', async () => {
      const res = await register('  Ayesha.Khan@Example.COM ');
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ message: expect.stringContaining('6-digit code'), email: 'ayesha.khan@example.com' });
      expect(res.body.accessToken).toBeUndefined();

      expect(mail.outbox).toHaveLength(1);
      const [sent] = mail.outbox;
      expect(sent.to).toBe('ayesha.khan@example.com');
      expect(sent.subject).toBe('Your MedPrep AI verification code');
      expect(sent.text).toMatch(/^Your MedPrep AI verification code is \d{6}\. It expires in 10 minutes\. If you didn't request this, ignore this email\.$/);
      expect(sent.html).toContain(codeFor('ayesha.khan@example.com'));

      const user = await db.collection('users').findOne({ email: 'ayesha.khan@example.com' });
      expect(user).toMatchObject({ emailVerified: false, role: 'student' });
    });

    it('stores the OTP hashed (bcrypt), never as plain text, with a 10-minute expiry', async () => {
      await register('hash@example.com');
      const code = codeFor('hash@example.com');
      const [row] = await otpRows('hash@example.com');

      expect(row).toMatchObject({ purpose: 'verify_email', attempts: 0, usedAt: null });
      expect(row.codeHash).toMatch(/^\$2[aby]\$10\$/);
      expect(JSON.stringify(row)).not.toContain(code); // the code appears nowhere in the document
      await expect(bcrypt.compare(code, row.codeHash)).resolves.toBe(true);
      const minutes = (row.expiresAt.getTime() - row.createdAt.getTime()) / 60_000;
      expect(minutes).toBeCloseTo(10, 1);

      const indexes = await db.collection('otp_codes').indexes();
      expect(indexes).toContainEqual(expect.objectContaining({ key: { expiresAt: 1 }, expireAfterSeconds: 0 }));
    });

    it('answers 503 "Couldn\'t send the email" if sending fails, keeps no half-created account, and keeps running', async () => {
      const deliver = jest
        .spyOn(MailService.prototype as unknown as { deliver: () => Promise<void> }, 'deliver')
        .mockRejectedValueOnce(new Error('SMTP connection refused'));

      const res = await register('nomail@example.com');
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ statusCode: 503, code: 'EMAIL_SEND_FAILED', message: EMAIL_SEND_FAILED });
      expect(await db.collection('users').countDocuments({ email: 'nomail@example.com' })).toBe(0);
      expect(await db.collection('otp_codes').countDocuments({ email: 'nomail@example.com' })).toBe(0);
      expect(logLines).toContainEqual(expect.stringContaining('SMTP connection refused')); // reason logged

      deliver.mockRestore();
      expect((await register('nomail@example.com')).status).toBe(201); // the app still works; retry succeeds
    });
  });

  describe('verify-otp', () => {
    it('accepts the correct code: verifies the email, uses up the code, and returns a token', async () => {
      await register('ok@example.com');
      const code = codeFor('ok@example.com');

      const res = await verify('OK@example.com', code);
      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({ email: 'ok@example.com', emailVerified: true });
      const me = await http().get('/auth/me').set('Authorization', `Bearer ${res.body.accessToken}`);
      expect(me.status).toBe(200);

      expect((await db.collection('users').findOne({ email: 'ok@example.com' }))?.emailVerified).toBe(true);
      expect((await otpRows('ok@example.com'))[0].usedAt).toBeInstanceOf(Date);
      // A used code never works again
      expect((await verify('ok@example.com', code)).body.code).toBe('OTP_INVALID');
    });

    it('a wrong code is rejected and increments attempts', async () => {
      await register('wrong@example.com');
      const res = await verify('wrong@example.com', wrongCode(codeFor('wrong@example.com')));

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'OTP_WRONG', attemptsLeft: 4 });
      expect((await otpRows('wrong@example.com'))[0].attempts).toBe(1);
    });

    it('locks the code after 5 wrong attempts, even for the right code afterwards', async () => {
      await register('lock@example.com');
      const code = codeFor('lock@example.com');

      const results: string[] = [];
      for (let i = 0; i < 5; i++) results.push((await verify('lock@example.com', wrongCode(code))).body.code);
      expect(results).toEqual(['OTP_WRONG', 'OTP_WRONG', 'OTP_WRONG', 'OTP_WRONG', 'OTP_LOCKED']);
      expect((await otpRows('lock@example.com'))[0].attempts).toBe(5);

      const correct = await verify('lock@example.com', code);
      expect(correct.status).toBe(400);
      expect(correct.body.code).toBe('OTP_LOCKED');
      expect((await db.collection('users').findOne({ email: 'lock@example.com' }))?.emailVerified).toBe(false);
    });

    it('rejects an expired code', async () => {
      await register('old@example.com');
      const code = codeFor('old@example.com');
      await db.collection('otp_codes').updateOne({ email: 'old@example.com' }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

      const res = await verify('old@example.com', code);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('OTP_EXPIRED');
    });
  });

  describe('resend-otp', () => {
    it('enforces a 60-second cooldown, then sends a new code that replaces the old one', async () => {
      await register('again@example.com');
      const firstCode = codeFor('again@example.com');

      // Within 60 s: same generic answer, but no new email
      const early = await resend('again@example.com');
      expect(early.status).toBe(200);
      expect(early.body).toEqual({ message: RESEND_MESSAGE });
      expect(mail.outbox).toHaveLength(1);

      // 61 s later (moved back in the database instead of waiting)
      await db.collection('otp_codes').updateMany({ email: 'again@example.com' }, { $set: { createdAt: new Date(Date.now() - 61_000) } });
      expect((await resend('again@example.com')).body).toEqual({ message: RESEND_MESSAGE });
      expect(mail.outbox).toHaveLength(2);
      const secondCode = codeFor('again@example.com');

      expect(await otpRows('again@example.com')).toHaveLength(1); // the older code was deleted
      // The old code no longer works: it is checked against the new code only (counts as a wrong guess)
      if (secondCode !== firstCode) {
        const old = await verify('again@example.com', firstCode);
        expect(old.status).toBe(400);
        expect(old.body.code).toBe('OTP_WRONG');
      }
      expect((await verify('again@example.com', secondCode)).status).toBe(200);
    });

    it('gives the same answer for an unknown email, without sending anything', async () => {
      const res = await resend('nobody@example.com');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: RESEND_MESSAGE });
      expect(mail.outbox).toHaveLength(0);
    });
  });

  describe('login', () => {
    it('refuses an unverified account with 403 EMAIL_NOT_VERIFIED and sends a fresh code', async () => {
      await register('unverified@example.com');
      await db.collection('otp_codes').updateMany({}, { $set: { createdAt: new Date(Date.now() - 61_000) } });

      const res = await login('unverified@example.com');
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 'EMAIL_NOT_VERIFIED', email: 'unverified@example.com' });
      expect(res.body.accessToken).toBeUndefined();
      expect(mail.outbox).toHaveLength(2); // register + fresh code
      expect((await verify('unverified@example.com', codeFor('unverified@example.com'))).status).toBe(200);
    });

    it('register -> verify -> login works; wrong password and unknown email get the same generic 401', async () => {
      await register('  Ayesha.Khan@Example.COM ');
      await verify('ayesha.khan@example.com', codeFor('ayesha.khan@example.com'));

      const ok = await login('AYESHA.khan@example.com ');
      expect(ok.status).toBe(200);
      expect(ok.body.user).toMatchObject({ email: 'ayesha.khan@example.com', emailVerified: true });

      const wrongPassword = await login('ayesha.khan@example.com', 'Wrong1234');
      const unknownEmail = await login('nobody@example.com');
      expect(wrongPassword.status).toBe(401);
      expect(wrongPassword.body.message).toBe(INVALID_LOGIN);
      expect(unknownEmail.body).toEqual(wrongPassword.body);
      // ...while the server log says which one it was
      expect(logLines).toContainEqual(expect.stringMatching(/wrong password for user /));
      expect(logLines).toContain('Login failed: no account for n***@example.com');
    });
  });

  it('never writes an OTP code or a password into the logs', async () => {
    await register('secret@example.com');
    const code = codeFor('secret@example.com');
    await verify('secret@example.com', wrongCode(code));
    await verify('secret@example.com', code);
    await login('secret@example.com', 'Wrong1234');

    expect(logLines.length).toBeGreaterThan(0);
    for (const line of logLines) {
      expect(line).not.toContain(code);
      expect(line).not.toContain(PASSWORD);
    }
  });

  it('throttles resend-otp (3 per minute per address)', async () => {
    process.env.THROTTLE_IN_TESTS = 'true';
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) statuses.push((await resend('throttle@example.com')).status);
      expect(statuses).toEqual([200, 200, 200, 429]);
    } finally {
      delete process.env.THROTTLE_IN_TESTS;
    }
  });

  // Last: it stops the database
  it('answers 503 with a clear message when the database is down', async () => {
    await mongo.stop();
    const res = await login('ayesha.khan@example.com');
    expect(res.status).toBe(503);
    expect(res.body.message).toBe(DATABASE_UNAVAILABLE_MESSAGE);
  });
});
