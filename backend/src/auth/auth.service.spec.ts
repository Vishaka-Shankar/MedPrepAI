import { ConflictException, ForbiddenException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { FakeOtpService } from '../../test/fake-otp.service';
import { InMemoryUsersService } from '../../test/in-memory-users.service';
import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { AuthService, INVALID_LOGIN, RESEND_MESSAGE } from './auth.service';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';

const SECRET = 'test-secret-that-is-long-enough-1234567890';

describe('AuthService', () => {
  let users: InMemoryUsersService;
  let otp: FakeOtpService;
  let mail: { sendOtp: jest.Mock };
  let jwt: JwtService;
  let auth: AuthService;

  beforeEach(() => {
    users = new InMemoryUsersService();
    otp = new FakeOtpService();
    mail = { sendOtp: jest.fn().mockResolvedValue(undefined) };
    jwt = new JwtService({ secret: SECRET, signOptions: { expiresIn: '1h' } });
    const tokens = new TokenService(jwt, users as unknown as UsersService);
    auth = new AuthService(users as unknown as UsersService, tokens, otp as unknown as OtpService, mail as unknown as MailService);
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

    it('returns a token for a verified account with the right password', async () => {
      await verifyAyesha();
      const res = await auth.login({ email: 'ayesha@example.com', password: 'secret123' });
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
});
