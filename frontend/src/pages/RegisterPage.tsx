import { FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { getErrorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/ui/Button';
import { emailProblem, nameProblem, PASSWORD_HINT, passwordProblem } from '../lib/validation';
import { AuthLayout } from '../components/layout/AuthLayout';
import styles from './AuthPage.module.css';
import { VerifyOtpState } from './VerifyOtpPage';

/**
 * Same rules as the backend's RegisterDto (src/lib/validation.ts), checked here first so the user
 * gets instant feedback. The backend still validates everything itself.
 */
export function validateRegistration(name: string, email: string, password: string, confirm: string): string | null {
  const problem = nameProblem(name) ?? emailProblem(email) ?? passwordProblem(password);
  if (problem) return problem;
  if (password !== confirm) return 'Passwords do not match.';
  return null;
}

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  // e.g. "Your account has been deleted." after deleting an account on the Profile page
  const notice = (useLocation().state as { notice?: string } | null)?.notice;
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const problem = validateRegistration(name, email, password, confirm);
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      // No token yet: the account must first be verified with the code we just emailed
      const res = await register(name.trim(), email.trim(), password);
      navigate('/verify-otp', { state: { email: res.email, notice: res.message } satisfies VerifyOtpState });
    } catch (err) {
      setError(getErrorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout showSwitch>
      <h1 className={styles.title}>Create your account</h1>
      <p className={styles.subtitle}>We will email you a 6-digit code to confirm your address.</p>
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <label className={styles.field}>
          Name
          <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </label>
        <label className={styles.field}>
          Email
          <input
            className={styles.input}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
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
            autoComplete="new-password"
          />
        </label>
        <label className={styles.field}>
          Confirm password
          <input
            className={styles.input}
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </label>
        <p className={styles.hint}>{PASSWORD_HINT}</p>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <Button type="submit" block disabled={submitting}>
          {submitting ? 'Creating account...' : 'Create account'}
        </Button>
      </form>
      <p className={styles.footer}>
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </AuthLayout>
  );
}
