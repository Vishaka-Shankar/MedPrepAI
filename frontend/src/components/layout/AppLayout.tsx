import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Logo } from '../ui/Logo';
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
 * Desktop: fixed navy sidebar (logo, sections, then the user's name with Profile and Log out at the bottom);
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
        <Logo />
        <div className={styles.headerLinks}>
          <NavLink to="/profile" className={styles.headerLink}>
            Profile
          </NavLink>
          {logoutButton}
        </div>
      </header>

      <aside className={styles.sidebar}>
        <div className={styles.sidebarLogo}>
          <Logo />
        </div>
        <nav aria-label="Main" className={styles.nav}>
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} className={linkClass}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className={styles.sidebarFooter}>
          <span className={styles.avatar} aria-hidden="true">
            {(user?.name?.trim()[0] ?? '?').toUpperCase()}
          </span>
          <div className={styles.footerText}>
            <span className={styles.userName}>{user?.name}</span>
            <div className={styles.footerLinks}>
              <nav aria-label="Account">
                <NavLink to="/profile" className={styles.footerLink}>
                  Profile
                </NavLink>
              </nav>
              <span aria-hidden="true">·</span>
              {logoutButton}
            </div>
          </div>
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
