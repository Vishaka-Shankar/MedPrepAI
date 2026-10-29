import { FormEvent, useState } from 'react';
import { getErrorCode, httpStatus } from '../../api/client';
import { usersApi } from '../../api/users';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { TextField } from '../../components/ui/TextField';
import { useApiError } from '../../hooks/useApiError';
import { PASSWORD_HINT, passwordProblem } from '../../lib/validation';
import styles from './Profile.module.css';

interface FieldErrors {
  current?: string;
  next?: string;
  confirm?: string;
}

/** Check the form before sending; the backend checks again. */
export function validatePasswordChange(current: string, next: string, confirm: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!current) errors.current = 'Enter your current password.';
  const problem = passwordProblem(next);
  if (problem) errors.next = problem;
  else if (next === current) errors.next = 'Your new password must be different from your current password.';
  else if (next !== confirm) errors.confirm = 'Passwords do not match.';
  return errors;
}

/**
 * PATCH /users/me/password. The backend logs out every other session and returns a fresh token
 * for this one, which replaces the saved token so this tab stays logged in.
 */
export function ChangePasswordForm() {
  const { updateSession } = useAuth();
  const toMessage = useApiError();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus('');
    setError('');
    const errors = validatePasswordChange(current, next, confirm);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSaving(true);
    try {
      const res = await usersApi.changePassword({ currentPassword: current, newPassword: next });
      updateSession({ accessToken: res.accessToken });
      setCurrent('');
      setNext('');
      setConfirm('');
      setStatus(res.message); // "Password changed. You were logged out on other devices."
    } catch (err) {
      const message = toMessage(err);
      if (getErrorCode(err) === 'WRONG_PASSWORD') setFieldErrors({ current: 'Your current password is incorrect.' });
      else if (httpStatus(err) === 400) setFieldErrors({ next: message }); // e.g. the same password again
      else setError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card as="section" className={styles.section} aria-labelledby="change-password">
      <h2 id="change-password" className={styles.sectionTitle}>
        Change password
      </h2>
      <p className={styles.text}>You will stay logged in here; other devices will be logged out.</p>
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <TextField
          label="Current password"
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          error={fieldErrors.current}
          autoComplete="current-password"
        />
        <TextField
          label="New password"
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          hint={PASSWORD_HINT}
          error={fieldErrors.next}
          autoComplete="new-password"
        />
        <TextField
          label="Confirm new password"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={fieldErrors.confirm}
          autoComplete="new-password"
        />
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {status && (
          <p className={styles.status} role="status">
            {status}
          </p>
        )}
        <div className={styles.actions}>
          <Button type="submit" disabled={saving || !current || !next || !confirm}>
            {saving ? 'Changing...' : 'Change password'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
