import { BadRequestException } from '@nestjs/common';
import { OtpCheck } from './otp.service';

/** 400 for a code problem, with a machine-readable `code` the frontend can react to. */
export function codeError(code: string, message: string, extra: Record<string, unknown> = {}): BadRequestException {
  return new BadRequestException({ statusCode: 400, code, message, ...extra });
}

export const otpInvalid = () => codeError('OTP_INVALID', 'Invalid or expired code. Request a new one.');

/**
 * The error for a failed code check. verify-otp, reset-password and change-email all use it,
 * so the same expiry, attempt and lock rules give the same answers everywhere.
 */
export function otpFailure(result: Exclude<OtpCheck, { status: 'ok' }>): BadRequestException {
  switch (result.status) {
    case 'wrong':
      return codeError('OTP_WRONG', `Incorrect code. ${result.attemptsLeft} attempt(s) left.`, {
        attemptsLeft: result.attemptsLeft,
      });
    case 'expired':
      return codeError('OTP_EXPIRED', 'This code has expired. Request a new one.');
    case 'locked':
      return codeError('OTP_LOCKED', 'Too many wrong attempts. Request a new code.');
    default:
      return otpInvalid();
  }
}
