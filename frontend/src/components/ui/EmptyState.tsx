import { ReactNode } from 'react';
import styles from './EmptyState.module.css';

interface Props {
  title: string;
  description?: string;
  /** Buttons or links shown under the text */
  children?: ReactNode;
}

/** A centred message for "nothing here yet", with optional actions. */
export function EmptyState({ title, description, children }: Props) {
  return (
    <div className={styles.empty}>
      <h2 className={styles.title}>{title}</h2>
      {description && <p className={styles.description}>{description}</p>}
      {children && <div className={styles.actions}>{children}</div>}
    </div>
  );
}
