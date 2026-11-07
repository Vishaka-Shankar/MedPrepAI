import { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Logo } from '../ui/Logo';
import styles from './AuthLayout.module.css';

/**
 * What the brand panel promises. Each point is an FYP-I requirement from the SRS:
 * REQ-PRQ-4 (cited explanation for a wrong answer), REQ-PRQ-1 / 4.4.1 (past papers by subject,
 * topic and year) and 4.5 (rule-based, explainable priorities by MDCAT weightage).
 */
export const AUTH_HEADLINE = 'Your MDCAT prep, all in one place.';
export const AUTH_POINTS = [
  'A cited explanation for every question you get wrong',
  'Past-paper MCQs organised by subject, topic and year',
  'Study priorities ranked by MDCAT weightage, with the reason shown',
];

interface Props {
  children: ReactNode;
  /** Show the Log in / Sign up switch above the form (login and register pages only). */
  showSwitch?: boolean;
}

/**
 * The frame of the logged-out pages (log in, sign up, verify email, forgot password):
 * a navy brand panel on the left and the form on the right. Below 900px the panel is hidden
 * and only the logo stays above the form.
 */
export function AuthLayout({ children, showSwitch = false }: Props) {
  const tabClass = ({ isActive }: { isActive: boolean }) => (isActive ? `${styles.tab} ${styles.tabActive}` : styles.tab);
  return (
    <div className={styles.page}>
      <aside className={styles.brand}>
        <Logo size="lg" />
        <div className={styles.pitch}>
          <p className={styles.eyebrow}>MDCAT preparation</p>
          <p className={styles.headline}>{AUTH_HEADLINE}</p>
          <ul className={styles.points}>
            {AUTH_POINTS.map((point) => (
              <li key={point}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className={styles.credit}>SZABIST Karachi · Final Year Project</p>
      </aside>

      <main className={styles.formSide}>
        <div className={styles.formBox}>
          <div className={styles.mobileLogo}>
            <Logo tone="light" />
          </div>
          {showSwitch && (
            <nav aria-label="Account" className={styles.switch}>
              <NavLink to="/login" className={tabClass}>
                Log in
              </NavLink>
              <NavLink to="/register" className={tabClass}>
                Sign up
              </NavLink>
            </nav>
          )}
          {children}
        </div>
      </main>
    </div>
  );
}
