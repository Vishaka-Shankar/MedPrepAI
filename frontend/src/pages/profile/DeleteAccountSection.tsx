import { startTransition, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getErrorCode } from '../../api/client';
import { usersApi } from '../../api/users';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { TextField } from '../../components/ui/TextField';
import { useApiError } from '../../hooks/useApiError';
import styles from './Profile.module.css';

export const ACCOUNT_DELETED = 'Your account has been deleted.';

/**
 * The danger zone. "Delete account" opens a dialog that asks for the password;
 * DELETE /users/me then removes the account and its chat history, the token is
 * cleared and the user lands on the Register page.
 */
export function DeleteAccountSection() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const toMessage = useApiError();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);

  function close() {
    setOpen(false);
    setPassword('');
    setPasswordError('');
    setError('');
  }

  async function handleConfirm() {
    setPasswordError('');
    setError('');
    setDeleting(true);
    try {
      await usersApi.deleteMe({ password });
      // One transition for both, so they show up in the same render. React Router runs navigations as
      // transitions; alone, logout() would render first and the login guard would open /login instead.
      startTransition(() => {
        logout();
        navigate('/register', { replace: true, state: { notice: ACCOUNT_DELETED } });
      });
    } catch (err) {
      if (getErrorCode(err) === 'WRONG_PASSWORD') setPasswordError('Your password is incorrect.');
      else setError(toMessage(err));
      setDeleting(false);
    }
  }

  return (
    <Card as="section" className={`${styles.section} ${styles.danger}`} aria-labelledby="delete-account">
      <h2 id="delete-account" className={styles.sectionTitle}>
        Delete account
      </h2>
      <p className={styles.text}>
        This permanently deletes your account and your chat history. It cannot be undone.
      </p>
      <div className={styles.actions}>
        <Button variant="danger" onClick={() => setOpen(true)}>
          Delete account
        </Button>
      </div>

      {open && (
        <ConfirmDialog
          title="Delete your account?"
          description={<p>Your account, chat history and saved citations will be deleted for good. Enter your password to confirm.</p>}
          confirmLabel="Delete my account"
          busyLabel="Deleting..."
          busy={deleting}
          error={error}
          confirmDisabled={!password}
          onConfirm={handleConfirm}
          onCancel={close}
        >
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={passwordError}
            autoComplete="current-password"
          />
        </ConfirmDialog>
      )}
    </Card>
  );
}
