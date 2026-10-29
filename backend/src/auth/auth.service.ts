import { ConflictException, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { MailService } from '../mail/mail.service';
import { OtpPurpose } from '../schemas/otp-code.schema';
import { PublicUser, toPublicUser, UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto, ResendOtpDto, ResetPasswordDto, VerifyOtpDto } from './dto/verify-otp.dto';
import { maskEmail } from './mask-email';
import { otpFailure, otpInvalid } from './otp-errors';
import { OTP_VALID_MINUTES, OtpService } from './otp.service';
import { TokenService } from './token.service';

/** bcrypt cost factor: 2^10 rounds, about 60-100 ms per hash. */
export const BCRYPT_ROUNDS = 10;
/** The one message for every failed login (unknown email or wrong password). */
export const INVALID_LOGIN = 'Invalid email or password';
/** Same answer for every resend request, so it can't reveal which emails are registered. */
export const RESEND_MESSAGE = 'If this email needs verification, a new code is on its way. You can ask again after 60 seconds.';
/** Same answer for every forgot-password request, registered email or not. */
export const FORGOT_PASSWORD_MESSAGE =
  'If an account exists for this email, we sent a password reset code. It expires in 10 minutes.';
export const PASSWORD_RESET_DONE = 'Your password has been reset. Please log in with your new password.';

export { maskEmail };

export interface AuthResponse {
  accessToken: string;
  user: PublicUser;
}

export interface RegisterResponse {
  message: string;
  email: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersService,
    private readonly tokens: TokenService,
    private readonly otp: OtpService,
    private readonly mail: MailService,
  ) {}

  /** Create an unverified account and email a code. No token until the email is verified. */
  async register(dto: RegisterDto): Promise<RegisterResponse> {
    if (await this.users.existsByEmail(dto.email)) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    let user: PublicUser;
    try {
      user = await this.users.create({ name: dto.name, email: dto.email, passwordHash });
    } catch (err) {
      // Two sign-ups with the same email at the same moment: the unique index catches it
      if (isDuplicateKeyError(err)) throw new ConflictException('An account with this email already exists');
      throw err;
    }

    try {
      await this.sendCode(user, 'verify_email');
    } catch (err) {
      // No email = no way to verify: remove the account (and its code) so registering again just works
      await this.otp.discardAll(user.id);
      await this.users.deleteUnverified(user.id);
      throw err;
    }
    return { message: 'Account created. We sent a 6-digit code to your email.', email: user.email };
  }

  /** Check the emailed code; on success the email is verified and the user is logged in. */
  async verifyOtp(dto: VerifyOtpDto): Promise<AuthResponse> {
    const user = await this.users.findByEmail(dto.email);
    if (!user) throw otpInvalid();

    const result = await this.otp.verify(user.id, 'verify_email', dto.code);
    if (result.status !== 'ok') throw otpFailure(result);
    await this.users.markEmailVerified(user.id);
    this.logger.log(`Email verified for user ${user.id}`);
    return this.buildResponse({ ...user, emailVerified: true });
  }

  /** Send a new code if the account exists, is unverified and the 60 s cooldown has passed. Same answer either way. */
  async resendOtp(dto: ResendOtpDto): Promise<{ message: string }> {
    const user = await this.users.findByEmail(dto.email);
    if (!user || user.emailVerified) {
      this.logger.log(`Resend skipped for ${maskEmail(dto.email)}: ${user ? 'already verified' : 'no account'}`);
    } else if ((await this.otp.secondsUntilResend(user.id, 'verify_email')) > 0) {
      this.logger.log(`Resend skipped for user ${user.id}: cooldown`);
    } else {
      await this.sendCode(user, 'verify_email');
    }
    return { message: RESEND_MESSAGE };
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const userDoc = await this.users.findByEmailWithPassword(dto.email);
    const passwordOk = userDoc ? await bcrypt.compare(dto.password, userDoc.passwordHash) : false;

    // Same message for "no such email" and "wrong password", so attackers
    // cannot use the login form to discover which emails are registered.
    // The real reason is written to the server log only, for debugging.
    if (!userDoc) {
      this.logger.warn(`Login failed: no account for ${maskEmail(dto.email)}`);
      throw new UnauthorizedException(INVALID_LOGIN);
    }
    if (!passwordOk) {
      this.logger.warn(`Login failed: wrong password for user ${userDoc.id as string}`);
      throw new UnauthorizedException(INVALID_LOGIN);
    }

    const user = toPublicUser(userDoc);
    if (!user.emailVerified) {
      // Only reached with the right password, so only the owner can trigger this email
      if ((await this.otp.secondsUntilResend(user.id, 'verify_email')) === 0) {
        await this.sendCode(user, 'verify_email');
      }
      this.logger.warn(`Login refused: email not verified for user ${user.id}`);
      throw new ForbiddenException({
        statusCode: 403,
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Please verify your email first. We sent a code to your inbox.',
        email: user.email,
      });
    }
    return this.buildResponse(user);
  }

  /**
   * Email a reset code if the account exists and the 60 s cooldown has passed.
   * Always the same answer, and a failed send is only logged (a 503 would reveal that the
   * account exists), so this route can't be used to find out which emails are registered.
   */
  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    const user = await this.users.findByEmail(dto.email);
    if (!user) {
      this.logger.log(`Password reset skipped for ${maskEmail(dto.email)}: no account`);
    } else if ((await this.otp.secondsUntilResend(user.id, 'reset_password')) > 0) {
      this.logger.log(`Password reset skipped for user ${user.id}: cooldown`);
    } else {
      try {
        await this.sendCode(user, 'reset_password');
      } catch {
        // MailService already logged why; drop the unsent code so the user can ask again at once
        await this.otp.discard(user.id, 'reset_password');
      }
    }
    return { message: FORGOT_PASSWORD_MESSAGE };
  }

  /**
   * Check the reset code (same expiry, attempt and lock rules as verify-otp), then set the new
   * password. That logs out every session and deletes every other code of the user.
   */
  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    const user = await this.users.findByEmail(dto.email);
    if (!user) throw otpInvalid();

    const result = await this.otp.verify(user.id, 'reset_password', dto.code);
    if (result.status !== 'ok') throw otpFailure(result);

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    // The code reached their inbox, which also proves they own the email
    if ((await this.users.setPassword(user.id, passwordHash, true)) === null) throw otpInvalid();
    await this.otp.discardAll(user.id);
    this.logger.log(`Password reset for user ${user.id}; older sessions logged out`);
    return { message: PASSWORD_RESET_DONE };
  }

  private async sendCode(user: PublicUser, purpose: OtpPurpose): Promise<void> {
    const code = await this.otp.issue(user, purpose);
    await this.mail.sendOtp(user.email, code, purpose, OTP_VALID_MINUTES); // the code is never logged
  }

  private async buildResponse(user: PublicUser): Promise<AuthResponse> {
    return { accessToken: await this.tokens.issue(user), user };
  }
}

export function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}
