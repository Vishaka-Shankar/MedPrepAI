import { FormEvent, useState } from 'react';
import { getErrorCode, httpStatus } from '../../api/client';
import { usersApi } from '../../api/users';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { emptyCode, OtpInput } from '../../components/ui/OtpInput';
import { TextField } from '../../components/ui/TextField';
import { useApiError } from '../../hooks/useApiError';
import { useCountdown } from '../../hooks/useCountdown';
import { describeCodeError } from '../../lib/otpErrors';
import { emailProblem, isCompleteCode } from '../../lib/validation';
import { CODE_VALID_MINUTES, RESEND_COOLDOWN_SECONDS } from '../VerifyOtpPage';
import styles from './Profile.module.css';

export const EMAIL_TAKEN = 'This email is already used by another account. Please choose a different one.';
const RESEND_HINT = 'Press "Send a new code" to get another one.';

/**
 * Two steps, like registration:
 *  1. new email + current password -> POST /users/me/change-email (the code goes to the NEW address)
 *  2. the code -> POST /users/me/change-email/verify -> the email is changed
 * The password is kept in memory only until the change is done, for "Send a new code".
 */
export function ChangeEmailForm({ currentEmail }: { currentEmail: string }) {
  const { updateSession } = useAuth();
  const toMessage = useApiError();
  const [step, setStep] = useState<'form' | 'code'>('form');
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [digits, setDigits] = useState(emptyCode);
  const [inputKey, setInputKey] = useState(0);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [secondsLeft, restartCooldown] = useCountdown(RESEND_COOLDOWN_SECONDS);

  const code = digits.join('');

  function clearBoxes() {
    setDigits(emptyCode());
    setInputKey((k) => k + 1);
  }

  function reset() {
    setStep('form');
    setNewEmail('');
    setPassword('');
    clearBoxes();
  }

  /**
   * Ask the backend to email a code. Returns 'sent', 'field' (a problem shown on the email or
   * password field, fixable only on the first step) or 'error' (429, 503, no connection).
   */
  async function requestCode(): Promise<'sent' | 'field' | 'error'> {
    try {
      const res = await usersApi.requestEmailChange({ newEmail: newEmail.trim(), password });
      setStatus(res.message);
      clearBoxes();
      restartCooldown();
      return 'sent';
    } catch (err) {
      const message = toMessage(err);
      if (httpStatus(err) === 409) setEmailError(EMAIL_TAKEN);
      else if (getErrorCode(err) === 'WRONG_PASSWORD') setPasswordError('Your password is incorrect.');
      else if (httpStatus(err) === 400) setEmailError(message); // e.g. "This is already your email address"
      else {
        setError(message);
        return 'error';
      }
      return 'field';
    }
  }

  async function handleRequest(e: FormEvent) {
    e.preventDefault();
    const problem =
      emailProblem(newEmail) ??
      (newEmail.trim().toLowerCase() === currentEmail ? 'This is already your email address.' : null);
    setEmailError(problem ?? '');
    setPasswordError(password ? '' : 'Enter your password to confirm.');
    setError('');
    setStatus('');
    if (problem || !password) return;

    setBusy(true);
    if ((await requestCode()) === 'sent') setStep('code');
    setBusy(false);
  }

  async function handleResend() {
    setError('');
    setSending(true);
    // e.g. someone took the address meanwhile: go back to the first step, where the field error shows
    if ((await requestCode()) === 'field') setStep('form');
    setSending(false);
  }

  async function handleConfirm(e: FormEvent) {
    e.preventDefault();
    if (!isCompleteCode(code)) return;
    setError('');
    setBusy(true);
    try {
      const res = await usersApi.confirmEmailChange({ code });
      updateSession({ user: res.user });
      reset();
      setStatus(res.message); // "Your email address has been changed."
    } catch (err) {
      if (httpStatus(err) === 409) {
        setError(`${EMAIL_TAKEN} Someone registered it a moment ago.`);
      } else {
        const { message, clearCode } = describeCodeError(err, RESEND_HINT);
        setError(httpStatus(err) === 401 ? toMessage(err) : message);
        if (clearCode) clearBoxes();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card as="section" className={styles.section} aria-labelledby="change-email">
      <h2 id="change-email" className={styles.sectionTitle}>
        Change email
      </h2>
      {status && (
        <p className={styles.status} role="status">
          {status}
        </p>
      )}

      {step === 'form' ? (
        <form className={styles.form} onSubmit={handleRequest} noValidate>
          <p className={styles.text}>We will send a code to the new address. Your email changes once you enter it.</p>
          <TextField
            label="New email"
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            error={emailError}
            autoComplete="email"
          />
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={passwordError}
            autoComplete="current-password"
          />
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <Button type="submit" disabled={busy || !newEmail.trim() || !password}>
              {busy ? 'Sending code...' : 'Send code'}
            </Button>
          </div>
        </form>
      ) : (
        <form className={styles.form} onSubmit={handleConfirm} noValidate>
          <p className={styles.text}>
            Enter the 6-digit code we sent to <strong>{newEmail.trim().toLowerCase()}</strong>. It expires in{' '}
            {CODE_VALID_MINUTES} minutes.
          </p>
          <OtpInput key={inputKey} value={digits} onChange={setDigits} disabled={busy} invalid={!!error} />
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <Button type="submit" disabled={busy || !isCompleteCode(code)}>
              {busy ? 'Confirming...' : 'Confirm new email'}
            </Button>
            <Button variant="outline" onClick={handleResend} disabled={sending || busy || secondsLeft > 0}>
              {sending ? 'Sending...' : secondsLeft > 0 ? `Send a new code (${secondsLeft}s)` : 'Send a new code'}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                reset();
                setError('');
                setStatus('');
              }}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
