import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { DASHBOARD_IS_SAMPLE, useDashboardData } from '../hooks/useDashboardData';
import {
  MIN_ATTEMPTS,
  masteryTone,
  priority,
  priorityReason,
  rankedTopics,
  strongestTopic,
  subjectAverages,
  TONE_LABEL,
  unrankedTopics,
  weakTopics,
} from '../lib/mastery';
import { DashboardData, TopicStat } from '../types/dashboard';
import { Button, buttonClass } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import styles from './DashboardPage.module.css';

export function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
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

/** How many rows the priorities table shows before "Show all". */
export const TABLE_ROWS = 6;
const MIN_LABEL = `${MIN_ATTEMPTS}+`;

const percent = (m: number) => `${Math.round(m * 100)}%`;
const joinNames = (topics: TopicStat[]) =>
  topics.length <= 1 ? (topics[0]?.name ?? '') : `${topics.slice(0, -1).map((t) => t.name).join(', ')} and ${topics[topics.length - 1].name}`;

/** A thin bar filled to the mastery: orange when weak, teal otherwise (the % is always written next to it). */
function MasteryBar({ topic }: { topic: TopicStat }) {
  const tone = masteryTone(topic);
  return (
    <span className={styles.masteryCell}>
      <span className={styles.bar} aria-hidden="true">
        <span className={tone === 'amber' ? styles.barWeak : styles.barFill} style={{ width: percent(topic.mastery) }} />
      </span>
      <span className={styles.masteryValue}>
        {percent(topic.mastery)}
        <span className="sr-only">, {TONE_LABEL[tone]}</span>
      </span>
    </span>
  );
}

function DashboardView({ data }: { data: DashboardData }) {
  const { user } = useAuth();
  const [showAll, setShowAll] = useState(false);
  const { summary, topics } = data;
  const ranked = rankedTopics(topics); // P = w x (1 - M), highest first
  const unranked = unrankedTopics(topics);
  const weak = weakTopics(topics);
  const strongest = strongestTopic(topics);
  const subjects = subjectAverages(topics);
  const accuracy = summary.attempts ? Math.round((summary.correct / summary.attempts) * 100) : 0;
  const top = ranked[0];
  const rows = showAll ? ranked : ranked.slice(0, TABLE_ROWS);

  return (
    <div className={styles.dashboard}>
      <header className={styles.header}>
        <div>
          {DASHBOARD_IS_SAMPLE && <p className={styles.sample}>Sample data</p>}
          <h1 className={styles.title}>
            {greeting(new Date().getHours())}, {user?.name ?? 'Student'}
          </h1>
        </div>
        {ranked.length > 0 && (
          <Link to="/quiz" className={buttonClass('primary')}>
            Practise top 3 topics
          </Link>
        )}
      </header>

      <section className={styles.kpis} aria-label="Summary">
        <Card as="section" className={styles.kpi} aria-label="Accuracy">
          <p className={styles.kpiLabel}>Accuracy</p>
          <p className={styles.kpiValue}>{accuracy}%</p>
          <p className={styles.kpiNote}>
            {summary.correct} of {summary.attempts} answers correct
          </p>
        </Card>
        <Card as="section" className={styles.kpi} aria-label="Topics practised">
          <p className={styles.kpiLabel}>Topics practised</p>
          <p className={styles.kpiValue}>{summary.topicsPractised}</p>
          <p className={styles.kpiNote}>across {summary.subjectsPractised} subjects</p>
        </Card>
        <Card as="section" className={styles.kpi} aria-label="Weak topics">
          <p className={styles.kpiLabel}>Weak topics</p>
          <p className={styles.kpiValue}>{weak.length}</p>
          <p className={styles.kpiNote}>mastery below 50%</p>
        </Card>
        <Card as="section" className={styles.kpi} aria-label="Strongest topic">
          <p className={styles.kpiLabel}>Strongest topic</p>
          <p className={styles.kpiValue}>{strongest ? percent(strongest.mastery) : '–'}</p>
          <p className={styles.kpiNote}>{strongest?.name ?? 'Not enough answers yet'}</p>
        </Card>
      </section>

      <div className={styles.columns}>
        <Card as="section" aria-labelledby="priorities-title" className={styles.tableCard}>
          <div className={styles.tableHead}>
            <h2 id="priorities-title" className={styles.cardTitle}>
              Study priorities
            </h2>
            <p className={styles.legend}>MDCAT weightage × (1 − mastery)</p>
          </div>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Topic</th>
                  <th scope="col">Mastery</th>
                  <th scope="col" className={styles.num}>
                    Attempts
                  </th>
                  <th scope="col" className={styles.num}>
                    Priority
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t, i) => (
                  <tr key={t.name}>
                    <td className={styles.rank}>{i + 1}</td>
                    <td>
                      <span className={styles.topicName}>{t.name}</span>
                      <span className={styles.topicReason}>
                        {t.subject} · {priorityReason(t)}
                      </span>
                    </td>
                    <td>
                      <MasteryBar topic={t} />
                    </td>
                    <td className={styles.num}>{t.attempts}</td>
                    <td className={`${styles.num} ${styles.score}`}>{priority(t).toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.tableFoot}>
            <span>
              {unranked.length > 0 && `${joinNames(unranked)} need ${MIN_LABEL} attempts before they are ranked.`}
            </span>
            {ranked.length > TABLE_ROWS && (
              <button type="button" className={styles.linkButton} onClick={() => setShowAll(!showAll)}>
                {showAll ? 'Show fewer' : `Show all ${ranked.length} topics`}
              </button>
            )}
          </div>
        </Card>

        <div className={styles.side}>
          <Card tone="primary" as="section" aria-label="Next up" className={styles.nextUp}>
            <p className={styles.eyebrow}>Next up</p>
            <h2 className={styles.nextTitle}>{top ? top.name : 'Find your priorities'}</h2>
            <p className={styles.nextText}>
              {top
                ? `${priorityReason(top).split(',')[0]} in MDCAT, and your mastery is ${percent(top.mastery)}.`
                : `Answer at least ${MIN_ATTEMPTS} questions in a topic to see what to study first.`}
            </p>
            <Link to="/quiz" className={`${buttonClass('outline')} ${styles.nextButton}`}>
              Start 10 questions
            </Link>
          </Card>

          {subjects.length > 0 && (
            <Card as="section" aria-labelledby="subjects-title">
              <h2 id="subjects-title" className={styles.cardTitle}>
                By subject
              </h2>
              <ul className={styles.subjects}>
                {subjects.map((s) => (
                  <li key={s.subject}>
                    <span className={styles.subjectRow}>
                      <span className={styles.subjectName}>{s.subject}</span>
                      <span className={styles.subjectValue}>{percent(s.mastery)} average mastery</span>
                    </span>
                    <span className={styles.subjectBar} aria-hidden="true">
                      <span style={{ width: percent(s.mastery) }} />
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
