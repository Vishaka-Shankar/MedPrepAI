import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import styles from './AppLayout.module.css';

export const NAV_ITEMS = [
  { to: '/chat', label: 'Chat' },
  { to: '/quiz', label: 'Quiz' },
  { to: '/videos', label: 'Videos' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/feedback', label: 'Feedback' },
];

/** Shown in the main navigation only for admins. */
export const ADMIN_NAV_ITEM = { to: '/admin/users', label: 'Admin' };

/**
 * The frame of every logged-in page.
 * Desktop: fixed 220px navy sidebar (wordmark, sections, then Profile and Log out at the bottom);
 * the page scrolls on its own.
 * Below 768px: the sections become a bottom tab bar, and the wordmark, Profile and Log out sit in a slim top bar.
 */
export function AppLayout() {
  const { user, logout } = useAuth();
  const navItems = user?.role === 'admin' ? [...NAV_ITEMS, ADMIN_NAV_ITEM] : NAV_ITEMS;
  const linkClass = ({ isActive }: { isActive: boolean }) => (isActive ? `${styles.navItem} ${styles.active}` : styles.navItem);

  const logoutButton = (
    <button type="button" className={styles.logout} onClick={() => logout()}>
      Log out
    </button>
  );

  return (
    <div className={styles.app}>
      <header className={styles.mobileHeader}>
        <span className={styles.wordmark}>MedPrep AI</span>
        <div className={styles.headerLinks}>
          <NavLink to="/profile" className={styles.headerLink}>
            Profile
          </NavLink>
          {logoutButton}
        </div>
      </header>

      <aside className={styles.sidebar}>
        <span className={`${styles.wordmark} ${styles.sidebarWordmark}`}>MedPrep AI</span>
        <nav aria-label="Main" className={styles.nav}>
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} className={linkClass}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className={styles.sidebarFooter}>
          <span className={styles.userName}>{user?.name}</span>
          <nav aria-label="Account">
            <NavLink to="/profile" className={styles.footerLink}>
              Profile
            </NavLink>
          </nav>
          {logoutButton}
        </div>
      </aside>

      <main className={styles.main}>
        <div className={styles.inner}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
