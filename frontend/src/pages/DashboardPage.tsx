import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { DASHBOARD_IS_SAMPLE, useDashboardData } from '../hooks/useDashboardData';
import { masteryTone, priority, priorityReason, TONE_LABEL, topPriorities } from '../lib/mastery';
import { DashboardData } from '../types/dashboard';
import { Button, buttonClass } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import styles from './DashboardPage.module.css';

export function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** A ring that fills to `percent`, drawn in SVG (no chart library). */
function Donut({ percent }: { percent: number }) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg className={styles.donut} viewBox="0 0 84 84" aria-hidden="true">
      <circle cx="42" cy="42" r={radius} className={styles.donutTrack} />
      <circle
        cx="42"
        cy="42"
        r={radius}
        className={styles.donutValue}
        strokeDasharray={`${(percent / 100) * circumference} ${circumference}`}
        transform="rotate(-90 42 42)"
      />
      <text x="42" y="47" textAnchor="middle" className={styles.donutText}>
        {percent}%
      </text>
    </svg>
  );
}

/** Dashboard page: loads its data through useDashboardData (mock today, API later). */
export function DashboardPage() {
  const { data, loading, error, reload } = useDashboardData();
  if (loading) return <p className={styles.status}>Loading your dashboard...</p>;
  if (error || !data) {
    return (
      <Card>
        <EmptyState title="Couldn't load your dashboard" description={error ?? undefined}>
          <Button onClick={reload}>Try again</Button>
        </EmptyState>
      </Card>
    );
  }
  return <DashboardView data={data} />;
}

function DashboardView({ data }: { data: DashboardData }) {
  const { user } = useAuth();
  const { summary, topics } = data;
  const priorities = topPriorities(topics, 3); // computed from the data: P = w x (1 - M)
  const accuracy = summary.attempts ? Math.round((summary.correct / summary.attempts) * 100) : 0;
  const top = priorities[0];

  return (
    <div className={styles.dashboard}>
      <header>
        {DASHBOARD_IS_SAMPLE && <p className={styles.sample}>Sample data</p>}
        <h1 className={styles.title}>
          {greeting(new Date().getHours())}, {user?.name ?? 'Student'}
        </h1>
      </header>

      <div className={styles.topRow}>
        <Card tone="primary" className={styles.hero}>
          <p className={styles.heroLabel}>Next up</p>
          <h2 className={styles.heroTitle}>
            {top ? `Practice ${top.name}: your top priority topic` : 'Answer a few questions to find your priorities'}
          </h2>
          <Link to="/quiz" className={`${buttonClass('outline')} ${styles.heroButton}`}>
            Start 10 questions
          </Link>
        </Card>

        <Card as="section" className={styles.stat} aria-label="Accuracy">
          <Donut percent={accuracy} />
          <div>
            <p className={styles.statLabel}>Accuracy</p>
            <p className={styles.statValue}>
              <span className="sr-only">{accuracy}% correct, </span>
              {summary.attempts} attempts
            </p>
          </div>
        </Card>

        <Card as="section" className={styles.stat} aria-label="Topics practised">
          <div>
            <p className={styles.statLabel}>Topics practised</p>
            <p className={styles.bigNumber}>{summary.topicsPractised}</p>
            <p className={styles.statLabel}>across {summary.subjectsPractised} subjects</p>
          </div>
        </Card>
      </div>

      <div className={styles.bottomRow}>
        <Card as="section" aria-labelledby="mastery-title">
          <h2 id="mastery-title" className={styles.cardTitle}>
            Topic mastery
          </h2>
          <p className={styles.legend}>Amber: weak. Teal: strong. Dashed: not enough data yet.</p>
          <ul className={styles.tiles} aria-label="Topics">
            {topics.map((t) => {
              const tone = masteryTone(t);
              return (
                <li key={t.name} className={`${styles.tile} ${styles[tone]}`} data-tone={tone}>
                  <span className={styles.tileName}>{t.name}</span>
                  {tone === 'insufficient' ? (
                    <span>Insufficient data</span>
                  ) : (
                    <span className={styles.tileValue}>
                      {t.mastery.toFixed(2)}
                      <span className="sr-only"> mastery, {TONE_LABEL[tone]}</span>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>

        <Card as="section" aria-labelledby="priorities-title" className={styles.priorities}>
          <h2 id="priorities-title" className={styles.cardTitle}>
            Study priorities
          </h2>
          <p className={styles.legend}>Weightage × (1 − mastery)</p>
          <ol className={styles.priorityList}>
            {priorities.map((t, i) => (
              <li key={t.name}>
                <p className={styles.priorityName}>
                  <strong>
                    {i + 1}. {t.name}
                  </strong>{' '}
                  <span className={styles.priorityScore}>{priority(t).toFixed(3)}</span>
                </p>
                <p className={styles.priorityReason}>{priorityReason(t)}</p>
              </li>
            ))}
          </ol>
          <Link to="/quiz" className={buttonClass('primary', true)}>
            Practice top 3
          </Link>
        </Card>
      </div>
    </div>
  );
}
