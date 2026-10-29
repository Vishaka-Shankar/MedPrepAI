import { FormEvent, useState } from 'react';
import { User, UserRole } from '../../api/auth';
import { usersApi } from '../../api/users';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Pill } from '../../components/ui/Pill';
import { TextField } from '../../components/ui/TextField';
import { useApiError } from '../../hooks/useApiError';
import { nameProblem } from '../../lib/validation';
import styles from './Profile.module.css';

export const ROLE_LABELS: Record<UserRole, string> = { student: 'Student', instructor: 'Instructor', admin: 'Admin' };

/** Name, email and role, and a form to change the name (PATCH /users/me). */
export function ProfileDetails({ user }: { user: User }) {
  const { updateSession } = useAuth();
  const toMessage = useApiError();
  const [name, setName] = useState(user.name);
  const [nameError, setNameError] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);

  const unchanged = name.trim() === user.name;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const problem = nameProblem(name);
    setNameError(problem ?? '');
    setStatus('');
    setError('');
    if (problem) return;
    setSaving(true);
    try {
      const updated = await usersApi.updateProfile({ name: name.trim() });
      updateSession({ user: updated }); // the sidebar shows the new name at once
      setName(updated.name);
      setStatus('Your name has been updated.');
    } catch (err) {
      setError(toMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card as="section" className={styles.section} aria-labelledby="profile-details">
      <h2 id="profile-details" className={styles.sectionTitle}>
        Your details
      </h2>
      <dl className={styles.details}>
        <dt>Name</dt>
        <dd>{user.name}</dd>
        <dt>Email</dt>
        <dd>{user.email}</dd>
        <dt>Role</dt>
        <dd>
          <Pill variant="outline">{ROLE_LABELS[user.role]}</Pill>
        </dd>
      </dl>

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <TextField
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={nameError}
          autoComplete="name"
          maxLength={80}
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
          <Button type="submit" disabled={saving || unchanged}>
            {saving ? 'Saving...' : 'Save name'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
