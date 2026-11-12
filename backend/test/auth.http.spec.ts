/**
 * Tests the real HTTP layer: routes, ValidationPipe, global JWT guard and JwtStrategy.
 * Only the database is replaced (InMemoryUsersService, FakeOtpService), so no MongoDB is needed.
 * The OTP rules themselves (hashing, expiry, attempts, cooldown) are in auth.db.e2e.spec.ts.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppController } from '../src/app.controller';
import { AuthModule } from '../src/auth/auth.module';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { OtpService } from '../src/auth/otp.service';
import { OtpCode } from '../src/schemas/otp-code.schema';
import { User } from '../src/schemas/user.schema';
import { UsersService } from '../src/users/users.service';
import { FakeOtpService } from './fake-otp.service';
import { InMemoryUsersService } from './in-memory-users.service';

describe('Auth over HTTP', () => {
  let app: INestApplication;
  const ayesha = { name: 'Ayesha', email: 'ayesha@example.com', password: 'secret123' };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ JWT_SECRET: 'http-test-secret-long-enough-0123456789', JWT_EXPIRES_IN: '1h' })],
        }),
        AuthModule,
      ],
      controllers: [AppController],
      providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
    })
      .overrideProvider(getModelToken(User.name))
      .useValue({})
      .overrideProvider(getModelToken(OtpCode.name))
      .useValue({})
      .overrideProvider(UsersService)
      .useValue(new InMemoryUsersService())
      .overrideProvider(OtpService)
      .useValue(new FakeOtpService())
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterEach(() => app.close());

  const server = () => app.getHttpServer();

  it('GET /health is public', async () => {
    await request(server()).get('/health').expect(200, { status: 'ok' });
  });

  it('register -> verify-otp -> login -> login code -> me works end to end', async () => {
    const reg = await request(server()).post('/auth/register').send(ayesha).expect(201);
    expect(reg.body).toEqual({ message: expect.any(String), email: 'ayesha@example.com' });
    expect(reg.body.accessToken).toBeUndefined(); // no token before the email is verified

    const verified = await request(server())
      .post('/auth/verify-otp')
      .send({ email: 'Ayesha@Example.com', code: FakeOtpService.CODE })
      .expect(200);
    expect(verified.body.user).toMatchObject({ email: 'ayesha@example.com', role: 'student', emailVerified: true });

    // Step 1: the right password emails a login code, still no token
    const step1 = await request(server())
      .post('/auth/login')
      .send({ email: 'AYESHA@example.com', password: 'secret123' })
      .expect(200);
    expect(step1.body).toEqual({ twoFactorRequired: true, email: 'ayesha@example.com', message: expect.any(String) });

    // Step 2: the emailed code gives the token
    const login = await request(server())
      .post('/auth/login/verify')
      .send({ email: 'ayesha@example.com', code: FakeOtpService.CODE })
      .expect(200);

    const me = await request(server())
      .get('/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);
    expect(me.body).toEqual(verified.body.user);
  });

  it('login before verifying is 403 EMAIL_NOT_VERIFIED', async () => {
    await request(server()).post('/auth/register').send(ayesha).expect(201);
    const res = await request(server()).post('/auth/login').send({ email: ayesha.email, password: ayesha.password }).expect(403);
    expect(res.body).toMatchObject({ code: 'EMAIL_NOT_VERIFIED', email: 'ayesha@example.com' });
  });

  it('login/verify refuses a wrong code and validates its input', async () => {
    await request(server()).post('/auth/register').send(ayesha).expect(201);
    await request(server()).post('/auth/verify-otp').send({ email: ayesha.email, code: FakeOtpService.CODE }).expect(200);
    await request(server()).post('/auth/login').send({ email: ayesha.email, password: ayesha.password }).expect(200);

    const wrong = await request(server()).post('/auth/login/verify').send({ email: ayesha.email, code: '000000' }).expect(400);
    expect(wrong.body.accessToken).toBeUndefined();
    const bad = await request(server()).post('/auth/login/verify').send({ email: ayesha.email, code: '12ab' }).expect(400);
    expect(bad.body.message).toContain('code must be 6 digits');
  });

  it('login/resend always gives the same answer', async () => {
    const res = await request(server()).post('/auth/login/resend').send({ email: 'nobody@example.com' }).expect(200);
    expect(res.body).toEqual({ message: expect.any(String) });
  });

  it('verify-otp validates its input (6 digits)', async () => {
    const res = await request(server()).post('/auth/verify-otp').send({ email: ayesha.email, code: '12ab' }).expect(400);
    expect(res.body.message).toContain('code must be 6 digits');
  });

  it('GET /auth/me without a token is 401', async () => {
    await request(server()).get('/auth/me').expect(401);
  });

  it('GET /auth/me with a forged token is 401', async () => {
    await request(server()).get('/auth/me').set('Authorization', 'Bearer not.a.real.token').expect(401);
  });

  it('register with invalid input is 400 with the reasons', async () => {
    const res = await request(server())
      .post('/auth/register')
      .send({ name: 'A', email: 'bad', password: 'short' })
      .expect(400);
    expect(res.body.message).toEqual(
      expect.arrayContaining([expect.stringContaining('name'), expect.stringContaining('email'), expect.stringContaining('password')]),
    );
  });

  it('register cannot set its own role (unknown fields are rejected)', async () => {
    const res = await request(server())
      .post('/auth/register')
      .send({ ...ayesha, role: 'instructor' })
      .expect(400);
    expect(res.body.message).toContain('property role should not exist');
  });

  it('registering the same email twice is 409', async () => {
    await request(server()).post('/auth/register').send(ayesha).expect(201);
    await request(server()).post('/auth/register').send(ayesha).expect(409);
  });

  it('login with a wrong password is 401', async () => {
    await request(server()).post('/auth/register').send(ayesha).expect(201);
    await request(server())
      .post('/auth/login')
      .send({ email: ayesha.email, password: 'wrong1234' })
      .expect(401);
  });
});
