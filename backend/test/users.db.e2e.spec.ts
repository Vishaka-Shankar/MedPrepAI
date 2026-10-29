/**
 * User CRUD, roles and password reset, end to end: the real AppModule (guards, ValidationPipe,
 * bcrypt, Mongoose, MailService in test mode) against a throwaway MongoDB (mongodb-memory-server).
 * Emailed codes are read from MailService.outbox, the way a user reads them from their inbox.
 */
import { INestApplication, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { configureApp } from '../src/app.setup';
import { FORGOT_PASSWORD_MESSAGE, INVALID_LOGIN } from '../src/auth/auth.service';
import { SESSION_EXPIRED } from '../src/auth/jwt.strategy';
import { NOT_ALLOWED } from '../src/auth/roles.guard';
import { MailService } from '../src/mail/mail.service';
import { User } from '../src/schemas/user.schema';
import { EMAIL_IN_USE, WRONG_PASSWORD } from '../src/users/account.service';
import { readAdminEnv, seedAdmin } from '../src/users/seed-admin';

jest.setTimeout(120_000); // the first run downloads a MongoDB binary

const PASSWORD = 'Secret123';
const NEW_PASSWORD = 'Brand9new';
const ADMIN = { name: 'Site Admin', email: 'admin@example.com', password: 'Admin1234' };

describe('users CRUD, roles and password reset against a real MongoDB (e2e)', () => {
  let mongo: MongoMemoryServer;
  let app: INestApplication;
  let db: Connection;
  let userModel: Model<User>;
  let mail: MailService;
  let passwordHash: string;
  const logLines: string[] = [];

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongo.getUri('medprep_users_e2e'); // replaces the Atlas URI from ../.env
    const { AppModule } = await import('../src/app.module');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app, 'http://localhost:5173');
    await app.init();

    db = app.get<Connection>(getConnectionToken());
    userModel = db.model<User>('User');
    await userModel.syncIndexes(); // unique email
    await db.model('OtpCode').syncIndexes();
    mail = app.get(MailService);
    passwordHash = await bcrypt.hash(PASSWORD, 10);

    for (const level of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logLines.push(String(args[0]));
      });
    }
  });

  beforeEach(async () => {
    for (const name of ['users', 'otp_codes', 'chat_messages', 'citations']) await db.collection(name).deleteMany({});
    mail.outbox.length = 0;
    logLines.length = 0;
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
    await mongo?.stop();
  });

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** A verified account, created straight in the database (registration itself is tested in auth.db.e2e). */
  async function addUser(name: string, email: string, role: 'student' | 'admin' = 'student'): Promise<string> {
    const user = await userModel.create({ name, email, passwordHash, role, emailVerified: true });
    return user.id as string;
  }
  async function loginToken(email: string, password = PASSWORD): Promise<string> {
    const res = await http().post('/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  }
  /** Ayesha (student) with a token: the "me" in most tests. */
  async function ayesha(): Promise<{ id: string; token: string }> {
    const id = await addUser('Ayesha Khan', 'ayesha@example.com');
    return { id, token: await loginToken('ayesha@example.com') };
  }
  /** The admin, created by the same function `npm run db:seed-admin` uses. */
  async function admin(): Promise<{ id: string; token: string }> {
    await seedAdmin(userModel, ADMIN);
    const token = await loginToken(ADMIN.email, ADMIN.password);
    const me = await http().get('/users/me').set(auth(token));
    return { id: me.body.id as string, token };
  }
  function codeFor(email: string): string {
    const message = [...mail.outbox].reverse().find((m) => m.to === email);
    const code = message?.text.match(/\b(\d{6})\b/)?.[1];
    if (!code) throw new Error(`no code emailed to ${email}`);
    return code;
  }
  const wrongCode = (code: string) => (code === '000000' ? '111111' : '000000');
  const count = (collection: string, filter: object = {}) => db.collection(collection).countDocuments(filter);

  /** Two chat messages with citations for `userId`, as the chat module will store them. */
  async function addChatHistory(userId: string): Promise<void> {
    const owner = new Types.ObjectId(userId);
    const { insertedIds } = await db.collection('chat_messages').insertMany([
      { userId: owner, question: 'What is osmosis?', inputMode: 'text', status: 'answered' },
      { userId: owner, question: 'Define mole.', inputMode: 'text', status: 'answered' },
    ]);
    await db.collection('citations').insertMany(
      Object.values(insertedIds).map((chatMessageId) => ({ chatMessageId, chunkId: new Types.ObjectId(), page: 3, snippet: 'text' })),
    );
  }

  describe('GET /users/me and PATCH /users/me', () => {
    it('returns the profile without passwordHash or tokenVersion', async () => {
      const me = await ayesha();
      const res = await http().get('/users/me').set(auth(me.token));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: me.id, name: 'Ayesha Khan', email: 'ayesha@example.com', role: 'student', emailVerified: true });
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|tokenVersion|\$2b\$/);
    });

    it('needs a token (401)', async () => {
      expect((await http().get('/users/me')).status).toBe(401);
    });

    it('updates the name (trimmed); rejects a too-short name and any attempt to set a role', async () => {
      const me = await ayesha();
      const ok = await http().patch('/users/me').set(auth(me.token)).send({ name: '  Ayesha K.  ' });
      expect(ok.status).toBe(200);
      expect(ok.body.name).toBe('Ayesha K.');

      expect((await http().patch('/users/me').set(auth(me.token)).send({ name: 'A' })).status).toBe(400);
      const promote = await http().patch('/users/me').set(auth(me.token)).send({ name: 'Ayesha', role: 'admin' });
      expect(promote.status).toBe(400);
      expect(promote.body.message).toContain('property role should not exist');
      expect((await userModel.findById(me.id))?.role).toBe('student');
    });
  });

  describe('PATCH /users/me/password', () => {
    const change = (token: string, body: object) => http().patch('/users/me/password').set(auth(token)).send(body);

    it('rejects a wrong current password (403 WRONG_PASSWORD)', async () => {
      const me = await ayesha();
      const res = await change(me.token, { currentPassword: 'Wrong1234', newPassword: NEW_PASSWORD });
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 'WRONG_PASSWORD', message: WRONG_PASSWORD });
    });

    it('rejects reusing the same password (400) and a weak new password (400)', async () => {
      const me = await ayesha();
      const same = await change(me.token, { currentPassword: PASSWORD, newPassword: PASSWORD });
      expect(same.status).toBe(400);
      expect(same.body.message).toMatch(/must be different/);

      const weak = await change(me.token, { currentPassword: PASSWORD, newPassword: 'onlyletters' });
      expect(weak.status).toBe(400);
      expect(weak.body.message).toContain('newPassword must contain at least one letter and one number');
    });

    it('changes it: old password and old sessions stop working, the returned token works', async () => {
      const me = await ayesha();
      const otherDevice = await loginToken('ayesha@example.com');

      const res = await change(me.token, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body.accessToken).toEqual(expect.any(String));

      for (const old of [me.token, otherDevice]) {
        const r = await http().get('/users/me').set(auth(old));
        expect(r.status).toBe(401);
        expect(r.body.message).toBe(SESSION_EXPIRED);
      }
      expect((await http().get('/users/me').set(auth(res.body.accessToken))).status).toBe(200);
      expect((await http().post('/auth/login').send({ email: 'ayesha@example.com', password: PASSWORD })).body.message).toBe(INVALID_LOGIN);
      await loginToken('ayesha@example.com', NEW_PASSWORD);
    });

    it('still accepts tokens made before token versions existed (no "tv" counts as version 0)', async () => {
      const me = await ayesha();
      const legacy = await app.get(JwtService).signAsync({ sub: me.id, email: 'ayesha@example.com', role: 'student' });
      expect((await http().get('/users/me').set(auth(legacy))).status).toBe(200);
    });
  });

  describe('POST /users/me/change-email (+ /verify)', () => {
    const ask = (token: string, newEmail: string, password = PASSWORD) =>
      http().post('/users/me/change-email').set(auth(token)).send({ newEmail, password });
    const confirm = (token: string, code: string) => http().post('/users/me/change-email/verify').set(auth(token)).send({ code });

    it('rejects an email that is already in use (409) and sends nothing', async () => {
      const me = await ayesha();
      await addUser('Bilal', 'bilal@example.com');
      const res = await ask(me.token, ' BILAL@example.com ');
      expect(res.status).toBe(409);
      expect(res.body.message).toBe(EMAIL_IN_USE);
      expect(mail.outbox).toHaveLength(0);
    });

    it('rejects a wrong password (403) and the current address (400)', async () => {
      const me = await ayesha();
      expect((await ask(me.token, 'new@example.com', 'Wrong1234')).status).toBe(403);
      expect((await ask(me.token, 'Ayesha@Example.com')).status).toBe(400);
      expect(mail.outbox).toHaveLength(0);
    });

    it('emails the NEW address; a wrong code is refused; the right code applies the change', async () => {
      const me = await ayesha();
      const res = await ask(me.token, '  New.Address@Example.COM ');
      expect(res.status).toBe(200);
      expect(res.body.email).toBe('new.address@example.com'); // trimmed + lowercased
      expect(mail.outbox).toHaveLength(1);
      expect(mail.outbox[0]).toMatchObject({ to: 'new.address@example.com', subject: 'Confirm your new MedPrep AI email address' });
      expect(await db.collection('otp_codes').findOne({ purpose: 'change_email' })).toMatchObject({ email: 'new.address@example.com' });

      // Nothing changes until the code is entered
      expect((await userModel.findById(me.id))?.email).toBe('ayesha@example.com');
      const code = codeFor('new.address@example.com');
      const wrong = await confirm(me.token, wrongCode(code));
      expect(wrong.status).toBe(400);
      expect(wrong.body).toMatchObject({ code: 'OTP_WRONG', attemptsLeft: 4 });

      const ok = await confirm(me.token, code);
      expect(ok.status).toBe(200);
      expect(ok.body.user.email).toBe('new.address@example.com');
      await loginToken('new.address@example.com');
      expect((await confirm(me.token, code)).body.code).toBe('OTP_INVALID'); // single use
    });

    it('has a 60 s cooldown between codes (429)', async () => {
      const me = await ayesha();
      expect((await ask(me.token, 'first@example.com')).status).toBe(200);
      expect((await ask(me.token, 'second@example.com')).status).toBe(429);
    });

    it('refuses the change if someone registered the address in the meantime (409)', async () => {
      const me = await ayesha();
      await ask(me.token, 'taken@example.com');
      await addUser('Late', 'taken@example.com');
      expect((await confirm(me.token, codeFor('taken@example.com'))).status).toBe(409);
      expect((await userModel.findById(me.id))?.email).toBe('ayesha@example.com');
    });

    it('verify without a pending code is OTP_INVALID', async () => {
      const me = await ayesha();
      const res = await confirm(me.token, '123456');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('OTP_INVALID');
    });
  });

  describe('DELETE /users/me', () => {
    it('needs the right password (403) and then deletes nothing', async () => {
      const me = await ayesha();
      const res = await http().delete('/users/me').set(auth(me.token)).send({ password: 'Wrong1234' });
      expect(res.status).toBe(403);
      expect(await count('users', { _id: new Types.ObjectId(me.id) })).toBe(1);
    });

    it("deletes the user, their chat_messages, citations and otp_codes, and nobody else's", async () => {
      const me = await ayesha();
      const bilal = await addUser('Bilal', 'bilal@example.com');
      await addChatHistory(me.id);
      await addChatHistory(bilal);
      await http().post('/auth/forgot-password').send({ email: 'ayesha@example.com' }); // an otp_codes row
      expect(await count('otp_codes')).toBe(1);

      const res = await http().delete('/users/me').set(auth(me.token)).send({ password: PASSWORD });
      expect(res.status).toBe(200);

      expect(await count('users', { email: 'ayesha@example.com' })).toBe(0);
      expect(await count('chat_messages', { userId: new Types.ObjectId(me.id) })).toBe(0);
      expect(await count('otp_codes')).toBe(0);
      // Bilal's history is untouched: 2 messages, 2 citations
      expect(await count('chat_messages')).toBe(2);
      expect(await count('citations')).toBe(2);
      expect((await http().get('/users/me').set(auth(me.token))).status).toBe(401); // old token is dead
    });
  });

  describe('admin routes', () => {
    it('a student gets 403 on every admin route, and cannot read or edit another user', async () => {
      const me = await ayesha();
      const bilal = await addUser('Bilal', 'bilal@example.com');
      const calls = [
        http().get('/users').set(auth(me.token)),
        http().get(`/users/${bilal}`).set(auth(me.token)),
        http().patch(`/users/${bilal}/role`).set(auth(me.token)).send({ role: 'admin' }),
        http().patch(`/users/${me.id}/role`).set(auth(me.token)).send({ role: 'admin' }),
        http().delete(`/users/${bilal}`).set(auth(me.token)),
      ];
      for (const res of await Promise.all(calls)) {
        expect(res.status).toBe(403);
        expect(res.body.message).toBe(NOT_ALLOWED);
      }
      expect(await count('users')).toBe(2);
      expect((await userModel.findById(me.id))?.role).toBe('student');
    });

    it('without a token they are 401', async () => {
      expect((await http().get('/users')).status).toBe(401);
    });

    it('GET /users paginates, searches name or email (ignoring case), and limits page size to 50', async () => {
      const { token } = await admin();
      for (const [name, email] of [
        ['Ayesha Khan', 'ayesha@example.com'],
        ['Bilal Ahmed', 'bilal@example.com'],
        ['Sana Ali', 'sana@uni.edu.pk'],
        ['Zara (test)', 'zara@example.com'],
      ]) {
        await addUser(name, email);
      }

      const page2 = await http().get('/users?page=2&limit=2').set(auth(token));
      expect(page2.status).toBe(200);
      expect(page2.body).toMatchObject({ page: 2, limit: 2, total: 5, totalPages: 3 });
      expect(page2.body.items).toHaveLength(2);
      expect(JSON.stringify(page2.body)).not.toContain('passwordHash');

      const byName = await http().get('/users?search=BILAL').set(auth(token));
      expect(byName.body.items.map((u: { email: string }) => u.email)).toEqual(['bilal@example.com']);
      const byEmail = await http().get('/users?search=uni.edu').set(auth(token));
      expect(byEmail.body.total).toBe(1);
      const special = await http().get('/users?search=' + encodeURIComponent('(test)')).set(auth(token));
      expect(special.body.total).toBe(1); // regex characters are matched literally

      const defaults = await http().get('/users').set(auth(token));
      expect(defaults.body).toMatchObject({ page: 1, limit: 20, total: 5 });

      for (const bad of ['limit=51', 'page=0', 'limit=abc', 'sort=name']) {
        expect((await http().get(`/users?${bad}`).set(auth(token))).status).toBe(400);
      }
    });

    it('GET /users/:id: 200, or 404 for an unknown or malformed id', async () => {
      const { token } = await admin();
      const bilal = await addUser('Bilal', 'bilal@example.com');
      expect((await http().get(`/users/${bilal}`).set(auth(token))).body.email).toBe('bilal@example.com');
      expect((await http().get(`/users/${new Types.ObjectId().toString()}`).set(auth(token))).status).toBe(404);
      expect((await http().get('/users/not-an-id').set(auth(token))).status).toBe(404);
    });

    it('PATCH /users/:id/role: promotion applies at once; only student/admin; not on yourself', async () => {
      const adm = await admin();
      const me = await ayesha();

      const promoted = await http().patch(`/users/${me.id}/role`).set(auth(adm.token)).send({ role: 'admin' });
      expect(promoted.status).toBe(200);
      expect(promoted.body.role).toBe('admin');
      // Her existing token now reaches admin routes (the role is read from the database each request)
      expect((await http().get('/users').set(auth(me.token))).status).toBe(200);

      expect((await http().patch(`/users/${me.id}/role`).set(auth(adm.token)).send({ role: 'superuser' })).status).toBe(400);
      expect((await http().patch(`/users/${me.id}/role`).set(auth(adm.token)).send({ role: 'instructor' })).status).toBe(400);
      expect((await http().patch(`/users/${new Types.ObjectId().toString()}/role`).set(auth(adm.token)).send({ role: 'student' })).status).toBe(404);

      const self = await http().patch(`/users/${adm.id}/role`).set(auth(adm.token)).send({ role: 'student' });
      expect(self.status).toBe(403);
      expect(self.body.message).toBe('You cannot change your own role');
      expect((await userModel.findById(adm.id))?.role).toBe('admin');
    });

    it('DELETE /users/:id: deletes the user and their data; 404 if unknown; an admin cannot delete themselves', async () => {
      const adm = await admin();
      const bilal = await addUser('Bilal', 'bilal@example.com');
      await addChatHistory(bilal);

      expect((await http().delete(`/users/${bilal}`).set(auth(adm.token))).status).toBe(200);
      expect(await count('users', { _id: new Types.ObjectId(bilal) })).toBe(0);
      expect(await count('chat_messages')).toBe(0);
      expect(await count('citations')).toBe(0);
      expect((await http().delete(`/users/${bilal}`).set(auth(adm.token))).status).toBe(404);

      const self = await http().delete(`/users/${adm.id}`).set(auth(adm.token));
      expect(self.status).toBe(403);
      expect(await count('users', { _id: new Types.ObjectId(adm.id) })).toBe(1);
    });
  });

  describe('password reset', () => {
    const forgot = (email: string) => http().post('/auth/forgot-password').send({ email });
    const reset = (email: string, code: string, newPassword = NEW_PASSWORD) =>
      http().post('/auth/reset-password').send({ email, code, newPassword });

    it('gives the same answer for an unknown email and sends nothing', async () => {
      await ayesha();
      const unknown = await forgot('nobody@example.com');
      const known = await forgot('AYESHA@example.com');
      expect(unknown.status).toBe(200);
      expect(unknown.body).toEqual({ message: FORGOT_PASSWORD_MESSAGE });
      expect(known.body).toEqual(unknown.body);
      expect(mail.outbox.map((m) => m.to)).toEqual(['ayesha@example.com']);
      expect(mail.outbox[0].subject).toBe('Your MedPrep AI password reset code');
    });

    it('still answers the same if the email cannot be sent (no 503 that would reveal the account)', async () => {
      await ayesha();
      const deliver = jest
        .spyOn(MailService.prototype as unknown as { deliver: () => Promise<void> }, 'deliver')
        .mockRejectedValueOnce(new Error('SMTP down'));
      const res = await forgot('ayesha@example.com');
      deliver.mockRestore();
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: FORGOT_PASSWORD_MESSAGE });
      expect(await count('otp_codes')).toBe(0); // the unsent code was dropped, so asking again works at once
    });

    it('refuses a wrong code, an expired code, a weak password and an unknown email', async () => {
      await ayesha();
      await forgot('ayesha@example.com');
      const code = codeFor('ayesha@example.com');

      expect((await reset('ayesha@example.com', wrongCode(code))).body).toMatchObject({ code: 'OTP_WRONG', attemptsLeft: 4 });
      expect((await reset('ayesha@example.com', code, 'short1')).status).toBe(400);
      expect((await reset('nobody@example.com', code)).body.code).toBe('OTP_INVALID');

      await db.collection('otp_codes').updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
      const expired = await reset('ayesha@example.com', code);
      expect(expired.status).toBe(400);
      expect(expired.body.code).toBe('OTP_EXPIRED');
      await loginToken('ayesha@example.com', PASSWORD); // password unchanged
    });

    it('locks the code after 5 wrong attempts, like verify-otp', async () => {
      await ayesha();
      await forgot('ayesha@example.com');
      const code = codeFor('ayesha@example.com');
      for (let i = 0; i < 5; i++) await reset('ayesha@example.com', wrongCode(code));
      expect((await reset('ayesha@example.com', code)).body.code).toBe('OTP_LOCKED');
    });

    it('resets: the old password and old sessions stop working, and every other code is deleted', async () => {
      const me = await ayesha();
      await http().post('/users/me/change-email').set(auth(me.token)).send({ newEmail: 'other@example.com', password: PASSWORD });
      await forgot('ayesha@example.com');
      expect(await count('otp_codes')).toBe(2); // change_email + reset_password

      const res = await reset('ayesha@example.com', codeFor('ayesha@example.com'));
      expect(res.status).toBe(200);

      expect(await count('otp_codes')).toBe(0);
      const old = await http().post('/auth/login').send({ email: 'ayesha@example.com', password: PASSWORD });
      expect(old.status).toBe(401);
      expect(old.body.message).toBe(INVALID_LOGIN);
      expect((await http().get('/users/me').set(auth(me.token))).status).toBe(401);
      await loginToken('ayesha@example.com', NEW_PASSWORD);
    });

    it('throttles forgot-password (3 per minute per address)', async () => {
      process.env.THROTTLE_IN_TESTS = 'true';
      try {
        const statuses: number[] = [];
        for (let i = 0; i < 4; i++) statuses.push((await forgot('throttle@example.com')).status);
        expect(statuses).toEqual([200, 200, 200, 429]);
      } finally {
        delete process.env.THROTTLE_IN_TESTS;
      }
    });
  });

  describe('admin seed (npm run db:seed-admin)', () => {
    it('creates a verified admin once; running again changes nothing', async () => {
      expect(await seedAdmin(userModel, ADMIN)).toBe('created');
      const doc = await userModel.findOne({ email: ADMIN.email }).select('+passwordHash');
      expect(doc).toMatchObject({ role: 'admin', emailVerified: true });
      expect(doc?.passwordHash).toMatch(/^\$2[aby]\$10\$/);
      expect(await seedAdmin(userModel, ADMIN)).toBe('already-admin');
      expect(await count('users')).toBe(1);
    });

    it('promotes an existing account without changing its password', async () => {
      await addUser('Ayesha Khan', 'ayesha@example.com');
      expect(await seedAdmin(userModel, { ...ADMIN, email: 'ayesha@example.com' })).toBe('promoted');
      expect((await userModel.findOne({ email: 'ayesha@example.com' }))?.role).toBe('admin');
      await loginToken('ayesha@example.com', PASSWORD);
    });

    it('checks the .env values without ever echoing the password', () => {
      expect(readAdminEnv({ ADMIN_NAME: ' Admin ', ADMIN_EMAIL: ' A@B.com ', ADMIN_PASSWORD: 'Admin1234' })).toEqual({
        name: 'Admin',
        email: 'a@b.com',
        password: 'Admin1234',
      });
      expect(() => readAdminEnv({ ADMIN_NAME: 'Admin', ADMIN_EMAIL: 'a@b.com', ADMIN_PASSWORD: 'weakpass' })).toThrow(
        /ADMIN_PASSWORD must be 8 to 72 characters/,
      );
      try {
        readAdminEnv({ ADMIN_EMAIL: 'bad', ADMIN_PASSWORD: 'leaky-secret' });
      } catch (err) {
        expect((err as Error).message).not.toContain('leaky-secret');
      }
    });
  });

  it('never writes an OTP code or a password into the logs', async () => {
    const me = await ayesha();
    await http().post('/users/me/change-email').set(auth(me.token)).send({ newEmail: 'new@example.com', password: PASSWORD });
    const emailCode = codeFor('new@example.com');
    await http().post('/users/me/change-email/verify').set(auth(me.token)).send({ code: emailCode });
    await http().post('/auth/forgot-password').send({ email: 'new@example.com' });
    const resetCode = codeFor('new@example.com');
    await http().post('/auth/reset-password').send({ email: 'new@example.com', code: wrongCode(resetCode), newPassword: NEW_PASSWORD });
    await http().post('/auth/reset-password').send({ email: 'new@example.com', code: resetCode, newPassword: NEW_PASSWORD });

    expect(logLines.length).toBeGreaterThan(0);
    for (const line of logLines) {
      for (const secret of [emailCode, resetCode, PASSWORD, NEW_PASSWORD]) expect(line).not.toContain(secret);
    }
  });
});
