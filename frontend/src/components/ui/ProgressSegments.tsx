import styles from './ProgressSegments.module.css';

interface Props {
  total: number;
  /** 1-based position: segments before it are done (teal), this one is current (navy) */
  current: number;
  label: string;
}

/** A row of bars showing progress, e.g. through a quiz. Screen readers get it as a progress bar. */
export function ProgressSegments({ total, current, label }: Props) {
  return (
    <div
      className={styles.segments}
      role="progressbar"
      aria-label={label}
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={current}
      aria-valuetext={`${current} of ${total}`}
    >
      {Array.from({ length: total }, (_, i) => {
        const state = i + 1 < current ? styles.done : i + 1 === current ? styles.current : styles.todo;
        return <span key={i} className={`${styles.segment} ${state}`} />;
      })}
    </div>
  );
}
