import { FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { getErrorCode, getErrorEmail, getErrorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/ui/Button';
import { AuthLayout } from '../components/layout/AuthLayout';
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
      // Logged in: GuestOnlyRoute sees the new user and redirects into the app (/chat by default)
      const codeStep = await login(email, password);
      if (codeStep) {
        // Two-step login: the right password emailed a login code, so go and enter it
        const next: VerifyOtpState = { email: codeStep.email, notice: codeStep.message, from, purpose: 'login' };
        navigate('/verify-otp', { state: next });
        return;
      }
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
    <AuthLayout showSwitch>
      <h1 className={styles.title}>Welcome back</h1>
      <p className={styles.subtitle}>Log in to continue your preparation.</p>
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
        <div className={styles.field}>
          <div className={styles.labelRow}>
            <label htmlFor="login-password">Password</label>
            <Link to="/forgot-password" className={styles.labelLink}>
              Forgot password?
            </Link>
          </div>
          <input
            id="login-password"
            className={styles.input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>
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
        New to MedPrep AI? <Link to="/register">Create an account</Link>
      </p>
    </AuthLayout>
  );
}
