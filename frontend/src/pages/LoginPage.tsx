import { FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { getErrorCode, getErrorEmail, getErrorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/ui/Button';
import styles from './AuthPage.module.css';
import { LoginPageState } from './ForgotPasswordPage';
import { VerifyOtpState } from './VerifyOtpPage';

export function LoginPage() {
  const { login, notice: authNotice } = useAuth();
  const navigate = useNavigate();
  const state = useLocation().state as (LoginPageState & { from?: string }) | null;
  const from = state?.from;
  // "Your session has expired" (from logging out), or "Your password has been reset" (from Forgot password)
  const notice = authNotice || state?.notice;
  const [email, setEmail] = useState(state?.email ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      // On success GuestOnlyRoute sees the new user and redirects into the app (/chat by default)
      await login(email, password);
    } catch (err) {
      if (getErrorCode(err) === 'EMAIL_NOT_VERIFIED') {
        // Right password, but the email was never verified: the server just sent a code, so go and enter it
        const state: VerifyOtpState = { email: getErrorEmail(err) ?? email.trim(), notice: getErrorMessage(err), from };
        navigate('/verify-otp', { state });
        return;
      }
      setError(getErrorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <p className={styles.wordmark}>MedPrep AI</p>
        <h1 className={styles.title}>Log in to MedPrep AI</h1>
        {notice && (
          <p className={styles.notice} role="status">
            {notice}
          </p>
        )}
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <label className={styles.field}>
            Email
            <input
              className={styles.input}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>
          <label className={styles.field}>
            Password
            <input
              className={styles.input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <Button type="submit" block disabled={submitting || !email || !password}>
            {submitting ? 'Logging in...' : 'Log in'}
          </Button>
        </form>
        <p className={styles.footer}>
          <Link to="/forgot-password">Forgot password?</Link>
        </p>
        <p className={styles.footerNext}>
          No account? <Link to="/register">Register</Link>
        </p>
      </div>
    </div>
  );
}
