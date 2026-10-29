import { useAuth } from '../auth/AuthContext';
import { ChangeEmailForm } from './profile/ChangeEmailForm';
import { ChangePasswordForm } from './profile/ChangePasswordForm';
import { DeleteAccountSection } from './profile/DeleteAccountSection';
import styles from './profile/Profile.module.css';
import { ProfileDetails } from './profile/ProfileDetails';

/**
 * /profile: the logged-in user's own account. The user comes from AuthContext (loaded by
 * GET /auth/me on page load and kept in step by updateSession after each change).
 */
export function ProfilePage() {
  const { user } = useAuth();
  if (!user) return null; // ProtectedRoute already sends logged-out users to /login

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Profile</h1>
      <ProfileDetails user={user} />
      <ChangePasswordForm />
      <ChangeEmailForm currentEmail={user.email} />
      <DeleteAccountSection />
    </div>
  );
}
