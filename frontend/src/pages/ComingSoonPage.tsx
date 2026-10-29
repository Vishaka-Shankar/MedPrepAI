import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import styles from './ComingSoonPage.module.css';

/** For sections that are planned but not built yet (Videos, Feedback). */
export function ComingSoonPage({ title, description }: { title: string; description: string }) {
  return (
    <section className={styles.page} aria-labelledby="page-title">
      <h1 id="page-title" className={styles.title}>
        {title}
      </h1>
      <Card className={styles.card}>
        <EmptyState title="Coming soon" description={description} />
      </Card>
    </section>
  );
}
