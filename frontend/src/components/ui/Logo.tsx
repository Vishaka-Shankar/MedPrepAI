import styles from './Logo.module.css';

/**
 * The MedPrep AI mark (a book with a plus, on teal) and the wordmark.
 * tone "dark" = white text for the navy sidebar and brand panel; "light" = navy text on white.
 */
export function Logo({ tone = 'dark', size = 'md' }: { tone?: 'dark' | 'light'; size?: 'md' | 'lg' }) {
  return (
    <span className={`${styles.logo} ${styles[tone]} ${styles[size]}`}>
      <span className={styles.mark} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19.5V5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2.5z" />
          <path d="M12 7v6" />
          <path d="M9 10h6" />
        </svg>
      </span>
      <span className={styles.wordmark}>MedPrep AI</span>
    </span>
  );
}
