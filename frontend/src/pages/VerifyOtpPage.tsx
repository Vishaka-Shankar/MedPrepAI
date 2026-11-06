import { FormEvent, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { getErrorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/ui/Button';
import { emptyCode, OtpInput } from '../components/ui/OtpInput';
import { useCountdown } from '../hooks/useCountdown';
import { describeCodeError } from '../lib/otpErrors';
import { isCompleteCode } from '../lib/validation';
import { AuthLayout } from '../components/layout/AuthLayout';
import styles from './AuthPage.module.css';

/** Same numbers as the backend (otp.service.ts). */
export const CODE_VALID_MINUTES = 10;
export const RESEND_COOLDOWN_SECONDS = 60;

/** What Register and Login pass when they send the user here. */
export interface VerifyOtpState {
  email?: string;
  /** The server's message, e.g. "Account created. We sent a 6-digit code to your email." */
  notice?: string;
  /** The page to open after verifying (GuestOnlyRoute reads it); /chat by default. */
  from?: string;
}

const RESEND_HINT = 'Press "Resend code" to get a new one.';

export function VerifyOtpPage() {
  const { verifyOtp, resendOtp } = useAuth();
  const state = (useLocation().state as VerifyOtpState | null) ?? {};
  const email = state.email ?? '';

  const [digits, setDigits] = useState(emptyCode);
  // Changing the key re-creates the boxes, which puts the cursor back in the first one
  const [inputKey, setInputKey] = useState(0);
  const [notice, setNotice] = useState(state.notice ?? '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  // A code was just sent (by Register or Login), so the cooldown starts now
  const [secondsLeft, restartCooldown] = useCountdown(RESEND_COOLDOWN_SECONDS);

  const code = digits.join('');
  const complete = isCompleteCode(code);

  function clearBoxes() {
    setDigits(emptyCode());
    setInputKey((k) => k + 1);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!complete) return;
    setError('');
    setSubmitting(true);
    try {
      // On success GuestOnlyRoute sees the new user and redirects into the app (/chat by default)
      await verifyOtp(email, code);
    } catch (err) {
      // A wrong or dead code empties the boxes; for 429, 503 (database or mail down) or no connection
      // the digits stay, so "Verify" can simply be pressed again
      const { message, clearCode } = describeCodeError(err, RESEND_HINT);
      setError(message);
      if (clearCode) clearBoxes();
      setSubmitting(false);
    }
  }

  async function handleResend() {
    setError('');
    setResending(true);
    try {
      setNotice(await resendOtp(email));
      clearBoxes();
      restartCooldown();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setResending(false);
    }
  }

  if (!email) {
    // Opened directly (e.g. a bookmark): we don't know which account to verify
    return (
      <AuthLayout>
        <h1 className={styles.title}>Verify your email</h1>
        <p className={styles.hint}>
          Log in with your email and password and we will send you a new code.
        </p>
        <p className={styles.footer}>
          <Link to="/login">Log in</Link> or <Link to="/register">Register</Link>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1 className={styles.title}>Verify your email</h1>
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <p className={styles.lead}>
          Enter the 6-digit code we sent to <strong>{email}</strong>.
        </p>
        <OtpInput key={inputKey} value={digits} onChange={setDigits} disabled={submitting} invalid={!!error} />
        <p className={styles.hint}>
          The code expires {CODE_VALID_MINUTES} minutes after it is sent. Can't find it? Check your spam folder.
        </p>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <Button type="submit" block disabled={submitting || !complete}>
          {submitting ? 'Verifying...' : 'Verify'}
        </Button>
        <Button variant="outline" block onClick={handleResend} disabled={resending || secondsLeft > 0}>
          {resending ? 'Sending...' : secondsLeft > 0 ? `Resend code (${secondsLeft}s)` : 'Resend code'}
        </Button>
      </form>
      <p className={styles.footer}>
        Wrong email? <Link to="/register">Register again</Link>
      </p>
    </AuthLayout>
  );
}
