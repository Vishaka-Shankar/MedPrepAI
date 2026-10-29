import { getErrorCode, getErrorMessage } from '../api/client';

/**
 * What to show after a code was refused. Used by email verification, password reset and
 * email change, which share the backend's rules (10 minutes, 5 attempts, single use).
 *  - message: the sentence to show
 *  - clearCode: true when the boxes should be emptied (the code is wrong or dead);
 *    false for 429/503/no connection, so the same code can simply be sent again
 */
export function describeCodeError(err: unknown, resendHint: string): { message: string; clearCode: boolean } {
  switch (getErrorCode(err)) {
    case 'OTP_WRONG':
      return { message: getErrorMessage(err), clearCode: true }; // "Incorrect code. 3 attempt(s) left."
    case 'OTP_EXPIRED':
      return { message: `This code has expired. ${resendHint}`, clearCode: true };
    case 'OTP_LOCKED':
      return { message: `Too many wrong attempts, so this code is locked. ${resendHint}`, clearCode: true };
    case 'OTP_INVALID':
      return { message: `This code is no longer valid (it may have expired). ${resendHint}`, clearCode: true };
    default:
      return { message: getErrorMessage(err), clearCode: false };
  }
}
