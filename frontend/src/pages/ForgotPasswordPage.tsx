import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authApi } from '../api/auth';
import { getErrorMessage } from '../api/client';
import { Button } from '../components/ui/Button';
import { emptyCode, OtpInput } from '../components/ui/OtpInput';
import { TextField } from '../components/ui/TextField';
import { useCountdown } from '../hooks/useCountdown';
import { describeCodeError } from '../lib/otpErrors';
import { emailProblem, isCompleteCode, PASSWORD_HINT, passwordProblem } from '../lib/validation';
import { AuthLayout } from '../components/layout/AuthLayout';
import styles from './AuthPage.module.css';
import { CODE_VALID_MINUTES, RESEND_COOLDOWN_SECONDS } from './VerifyOtpPage';

/** What the Login page receives after a successful reset. */
export interface LoginPageState {
  notice?: string;
  email?: string;
}

const RESEND_HINT = 'Press "Send a new code" to get another one.';

/**
 * Two steps on one page:
 *  1. email -> POST /auth/forgot-password (the answer is the same whether or not the email is registered)
 *  2. code + new password -> POST /auth/reset-password -> back to Login with the success message
 */
export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<'email' | 'reset'>('email');
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [notice, setNotice] = useState('');

  const [digits, setDigits] = useState(emptyCode);
  const [inputKey, setInputKey] = useState(0); // a new key re-creates the boxes and refocuses the first
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmError, setConfirmError] = useState('');

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [secondsLeft, restartCooldown] = useCountdown(RESEND_COOLDOWN_SECONDS);

  const code = digits.join('');

  function clearBoxes() {
    setDigits(emptyCode());
    setInputKey((k) => k + 1);
  }

  /** Step 1, and "Send a new code" in step 2. */
  async function sendCode() {
    setError('');
    const res = await authApi.forgotPassword({ email: email.trim() });
    setNotice(res.message);
    clearBoxes();
    restartCooldown();
    setStep('reset');
  }

  async function handleEmailSubmit(e: FormEvent) {
    e.preventDefault();
    const problem = emailProblem(email);
    setEmailError(problem ?? '');
    if (problem) return;
    setBusy(true);
    try {
      await sendCode();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleResend() {
    setSending(true);
    try {
      await sendCode();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSending(false);
    }
  }

  async function handleResetSubmit(e: FormEvent) {
    e.preventDefault();
    const pwProblem = passwordProblem(newPassword);
    const mismatch = !pwProblem && newPassword !== confirm ? 'Passwords do not match.' : '';
    setPasswordError(pwProblem ?? '');
    setConfirmError(mismatch);
    if (pwProblem || mismatch || !isCompleteCode(code)) return;

    setError('');
    setBusy(true);
    try {
      const res = await authApi.resetPassword({ email: email.trim(), code, newPassword });
      const state: LoginPageState = { notice: res.message, email: email.trim().toLowerCase() };
      navigate('/login', { replace: true, state });
    } catch (err) {
      const { message, clearCode } = describeCodeError(err, RESEND_HINT);
      setError(message);
      if (clearCode) clearBoxes();
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <h1 className={styles.title}>Reset your password</h1>
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}

      {step === 'email' ? (
        <form className={styles.form} onSubmit={handleEmailSubmit} noValidate>
          <p className={styles.lead}>Enter your account's email and we will send you a 6-digit code.</p>
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={emailError}
            autoComplete="email"
            autoFocus
          />
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <Button type="submit" block disabled={busy || !email.trim()}>
            {busy ? 'Sending...' : 'Send code'}
          </Button>
        </form>
      ) : (
        <form className={styles.form} onSubmit={handleResetSubmit} noValidate>
          <p className={styles.lead}>
            If <strong>{email.trim()}</strong> has an account, enter the code we sent there and choose a new password.
          </p>
          <OtpInput key={inputKey} value={digits} onChange={setDigits} disabled={busy} invalid={!!error} />
          <p className={styles.hint}>
            The code expires {CODE_VALID_MINUTES} minutes after it is sent. Can't find it? Check your spam folder.
          </p>
          <TextField
            label="New password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            hint={PASSWORD_HINT}
            error={passwordError}
            autoComplete="new-password"
          />
          <TextField
            label="Confirm new password"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            error={confirmError}
            autoComplete="new-password"
          />
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <Button type="submit" block disabled={busy || !isCompleteCode(code) || !newPassword || !confirm}>
            {busy ? 'Resetting...' : 'Reset password'}
          </Button>
          <Button variant="outline" block onClick={handleResend} disabled={sending || busy || secondsLeft > 0}>
            {sending ? 'Sending...' : secondsLeft > 0 ? `Send a new code (${secondsLeft}s)` : 'Send a new code'}
          </Button>
        </form>
      )}

      <p className={styles.footer}>
        Remembered it? <Link to="/login">Back to log in</Link>
      </p>
    </AuthLayout>
  );
}
