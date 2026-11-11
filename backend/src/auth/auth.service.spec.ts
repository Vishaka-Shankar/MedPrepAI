import { BadRequestException, ConflictException, ForbiddenException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { FakeOtpService } from '../../test/fake-otp.service';
import { InMemoryUsersService } from '../../test/in-memory-users.service';
import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { AuthResponse, AuthService, INVALID_LOGIN, LOGIN_CODE_SENT, LOGIN_RESEND_MESSAGE, RESEND_MESSAGE } from './auth.service';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';

const SECRET = 'test-secret-that-is-long-enough-1234567890';

describe('AuthService', () => {
  let users: InMemoryUsersService;
  let otp: FakeOtpService;
  let mail: { sendOtp: jest.Mock };
  let jwt: JwtService;
  let auth: AuthService;
  let settings: Record<string, unknown>; // what ConfigService.get returns (LOGIN_2FA)

  beforeEach(() => {
    settings = {};
    users = new InMemoryUsersService();
    otp = new FakeOtpService();
    mail = { sendOtp: jest.fn().mockResolvedValue(undefined) };
    jwt = new JwtService({ secret: SECRET, signOptions: { expiresIn: '1h' } });
    const tokens = new TokenService(jwt, users as unknown as UsersService);
    const config = { get: (key: string) => settings[key] } as unknown as ConfigService;
    auth = new AuthService(users as unknown as UsersService, tokens, otp as unknown as OtpService, mail as unknown as MailService, config);
  });

  const registerAyesha = () => auth.register({ name: 'Ayesha', email: 'ayesha@example.com', password: 'secret123' });
  const verifyAyesha = () => auth.verifyOtp({ email: 'ayesha@example.com', code: FakeOtpService.CODE });

  describe('register', () => {
    it('creates an unverified student, emails a code, and returns no token', async () => {
      const res = await registerAyesha();

      expect(res).toEqual({ message: expect.stringContaining('6-digit code'), email: 'ayesha@example.com' });
      expect(res).not.toHaveProperty('accessToken');
      expect(users.users[0]).toMatchObject({ email: 'ayesha@example.com', role: 'student', emailVerified: false });
      expect(mail.sendOtp).toHaveBeenCalledTimes(1);
      expect(mail.sendOtp).toHaveBeenCalledWith('ayesha@example.com', FakeOtpService.CODE, 'verify_email', 10);
    });

    it('stores a bcrypt hash, never the plain password', async () => {
      await registerAyesha();
      expect(users.users[0].passwordHash).not.toBe('secret123');
      expect(await bcrypt.compare('secret123', users.users[0].passwordHash)).toBe(true);
    });

    it('rejects a duplicate email with 409 Conflict', async () => {
      await registerAyesha();
      await expect(registerAyesha()).rejects.toBeInstanceOf(ConflictException);
    });

    it('turns a duplicate-key race from MongoDB into 409 Conflict', async () => {
      jest.spyOn(users, 'create').mockRejectedValueOnce(Object.assign(new Error('E11000'), { code: 11000 }));
      await expect(registerAyesha()).rejects.toBeInstanceOf(ConflictException);
    });

    it('removes the new account if the email cannot be sent, so registering again works', async () => {
      mail.sendOtp.mockRejectedValueOnce(new ServiceUnavailableException("Couldn't send the email, try again"));
      await expect(registerAyesha()).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(users.users).toHaveLength(0);
      await expect(registerAyesha()).resolves.toMatchObject({ email: 'ayesha@example.com' });
    });
  });

  describe('verifyOtp', () => {
    beforeEach(registerAyesha);

    it('verifies the email and returns a token whose subject is the user id', async () => {
      const res = await verifyAyesha();
      expect(res.user).toMatchObject({ email: 'ayesha@example.com', emailVerified: true });
      expect((await jwt.verifyAsync<{ sub: string }>(res.accessToken)).sub).toBe(res.user.id);
      expect(users.users[0].emailVerified).toBe(true);
    });

    it('rejects a wrong code with 400 OTP_WRONG and attempts left', async () => {
      await expect(auth.verifyOtp({ email: 'ayesha@example.com', code: '000000' })).rejects.toMatchObject({
        response: { code: 'OTP_WRONG', attemptsLeft: 4 },
      });
    });

    it('gives the generic OTP_INVALID for an unknown email', async () => {
      await expect(auth.verifyOtp({ email: 'nobody@example.com', code: '123456' })).rejects.toMatchObject({
        response: { code: 'OTP_INVALID' },
      });
    });
  });

  describe('resendOtp', () => {
    it('returns the same message for unknown, unverified and verified emails', async () => {
      await registerAyesha();
      expect(await auth.resendOtp({ email: 'nobody@example.com' })).toEqual({ message: RESEND_MESSAGE });
      expect(await auth.resendOtp({ email: 'ayesha@example.com' })).toEqual({ message: RESEND_MESSAGE });
      await verifyAyesha();
      expect(await auth.resendOtp({ email: 'ayesha@example.com' })).toEqual({ message: RESEND_MESSAGE });
      // register + one real resend; nothing for the unknown or the verified email
      expect(mail.sendOtp).toHaveBeenCalledTimes(2);
    });
  });

  describe('login', () => {
    beforeEach(registerAyesha);

    it('refuses an unverified account with 403 EMAIL_NOT_VERIFIED and sends a fresh code', async () => {
      mail.sendOtp.mockClear();
      await expect(auth.login({ email: 'ayesha@example.com', password: 'secret123' })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(auth.login({ email: 'ayesha@example.com', password: 'secret123' })).rejects.toMatchObject({
        response: { code: 'EMAIL_NOT_VERIFIED', email: 'ayesha@example.com' },
      });
      expect(mail.sendOtp).toHaveBeenCalled();
    });

    it('with LOGIN_2FA=false, returns a token straight away for the right password', async () => {
      settings.LOGIN_2FA = false;
      await verifyAyesha();
      const res = (await auth.login({ email: 'ayesha@example.com', password: 'secret123' })) as AuthResponse;
      expect(await jwt.verifyAsync(res.accessToken)).toMatchObject({ email: 'ayesha@example.com' });
    });

    it('rejects a wrong password with the generic 401, without sending mail', async () => {
      mail.sendOtp.mockClear();
      await expect(auth.login({ email: 'ayesha@example.com', password: 'wrong123' })).rejects.toThrow(
        new UnauthorizedException(INVALID_LOGIN),
      );
      expect(mail.sendOtp).not.toHaveBeenCalled(); // only the real owner can trigger a code email
    });

    it('gives the same 401 message for an unknown email', async () => {
      await expect(auth.login({ email: 'nobody@example.com', password: 'secret123' })).rejects.toThrow(
        new UnauthorizedException(INVALID_LOGIN),
      );
    });
  });

  describe('two-step login (LOGIN_2FA on, the default)', () => {
    const loginAyesha = () => auth.login({ email: 'ayesha@example.com', password: 'secret123' });
    beforeEach(async () => {
      await registerAyesha();
      await verifyAyesha();
      mail.sendOtp.mockClear();
      otp.issued.length = 0;
    });

    it('the right password emails a login code and returns no token', async () => {
      const res = await loginAyesha();
      expect(res).toEqual({ twoFactorRequired: true, email: 'ayesha@example.com', message: LOGIN_CODE_SENT });
      expect(res).not.toHaveProperty('accessToken');
      expect(otp.issued).toEqual([expect.objectContaining({ purpose: 'login', email: 'ayesha@example.com' })]);
      expect(mail.sendOtp).toHaveBeenCalledWith('ayesha@example.com', FakeOtpService.CODE, 'login', 10);
    });

    it('the right code gives the token, and the code works only once', async () => {
      await loginAyesha();
      const res = await auth.verifyLogin({ email: 'ayesha@example.com', code: FakeOtpService.CODE });
      expect(await jwt.verifyAsync(res.accessToken)).toMatchObject({ email: 'ayesha@example.com' });
      expect(res.user.email).toBe('ayesha@example.com');
      await expect(auth.verifyLogin({ email: 'ayesha@example.com', code: FakeOtpService.CODE })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('a wrong code is refused and gives no token', async () => {
      await loginAyesha();
      await expect(auth.verifyLogin({ email: 'ayesha@example.com', code: '000000' })).rejects.toMatchObject({
        response: expect.objectContaining({ attemptsLeft: 4 }),
      });
    });

    it('a code is useless without the password step first', async () => {
      await expect(auth.verifyLogin({ email: 'ayesha@example.com', code: FakeOtpService.CODE })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(auth.verifyLogin({ email: 'nobody@example.com', code: FakeOtpService.CODE })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('a verify-email code cannot be used as a login code', async () => {
      await loginAyesha();
      await otp.discard(users.users[0].id, 'login');
      await otp.issue(users.users[0], 'verify_email');
      await expect(auth.verifyLogin({ email: 'ayesha@example.com', code: FakeOtpService.CODE })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('resend sends a new code only while a login is waiting, with the same answer either way', async () => {
      expect(await auth.resendLogin({ email: 'ayesha@example.com' })).toEqual({ message: LOGIN_RESEND_MESSAGE });
      expect(mail.sendOtp).not.toHaveBeenCalled(); // no password step yet: nothing to resend

      await loginAyesha();
      mail.sendOtp.mockClear();
      expect(await auth.resendLogin({ email: 'ayesha@example.com' })).toEqual({ message: LOGIN_RESEND_MESSAGE });
      expect(mail.sendOtp).toHaveBeenCalledWith('ayesha@example.com', FakeOtpService.CODE, 'login', 10);

      expect(await auth.resendLogin({ email: 'nobody@example.com' })).toEqual({ message: LOGIN_RESEND_MESSAGE });
    });

    it('if the email cannot be sent, the login fails and the unsent code is dropped', async () => {
      mail.sendOtp.mockRejectedValueOnce(new ServiceUnavailableException('mail down'));
      await expect(loginAyesha()).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(await otp.hasActive(users.users[0].id, 'login')).toBe(false);
    });

    it('a wrong password sends no login code', async () => {
      await expect(auth.login({ email: 'ayesha@example.com', password: 'wrong123' })).rejects.toBeInstanceOf(UnauthorizedException);
      expect(mail.sendOtp).not.toHaveBeenCalled();
    });
  });
});
