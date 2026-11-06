import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { authApi } from '../api/auth';
import { tokenStorage } from '../api/client';
import { App } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { greeting } from './DashboardPage';

vi.mock('../api/auth', () => ({ authApi: { login: vi.fn(), register: vi.fn(), me: vi.fn() } }));
vi.mock('../api/chat', () => ({ USE_MOCK: false, chatApi: { history: vi.fn(), ask: vi.fn() } }));

async function openDashboard() {
  tokenStorage.set('saved-token');
  vi.mocked(authApi.me).mockResolvedValue({ id: '1', name: 'Ayesha Khan', email: 'a@x.com', role: 'student' });
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { name: /Ayesha Khan/ });
}

describe('Dashboard page (mock data)', () => {
  it('shows the Sample data label and a greeting with the user name', async () => {
    await openDashboard();
    expect(screen.getByText('Sample data')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Good (morning|afternoon|evening), Ayesha Khan$/);
  });

  it('shows the summary cards: accuracy, topics practised, weak topics, strongest topic', async () => {
    await openDashboard();
    const card = (name: string) => screen.getByRole('region', { name });
    expect(card('Accuracy')).toHaveTextContent('64%');
    expect(card('Accuracy')).toHaveTextContent('82 of 128 answers correct');
    expect(card('Topics practised')).toHaveTextContent('14');
    expect(card('Topics practised')).toHaveTextContent('across 3 subjects');
    expect(card('Weak topics')).toHaveTextContent('4'); // Cell biology, Equilibrium, Thermochemistry, Electrostatics
    expect(card('Strongest topic')).toHaveTextContent('80%Atomic structure');
  });

  it('puts the top priority in the Next up card', async () => {
    await openDashboard();
    const next = screen.getByRole('region', { name: 'Next up' });
    expect(within(next).getByRole('heading', { name: 'Cell biology' })).toBeInTheDocument();
    expect(next).toHaveTextContent('Heavily tested in MDCAT, and your mastery is 40%.');
    expect(within(next).getByRole('link', { name: 'Start 10 questions' })).toHaveAttribute('href', '/quiz');
    expect(screen.getByRole('link', { name: 'Practise top 3 topics' })).toHaveAttribute('href', '/quiz');
  });

  it('ranks topics in the priorities table with score, reason and mastery in words', async () => {
    await openDashboard();
    const table = within(screen.getByRole('region', { name: 'Study priorities' }));
    const rows = table.getAllByRole('row').slice(1); // without the header row
    expect(rows).toHaveLength(6);
    expect(rows[0]).toHaveTextContent('1Cell biologyBiology · Heavily tested, mastery low40%, Weak180.018');
    expect(rows[1]).toHaveTextContent('Equilibrium');
    expect(rows[2]).toHaveTextContent('Electrostatics');
    expect(table.getByText('Genetics and Optics need 5+ attempts before they are ranked.')).toBeInTheDocument();

    await userEvent.click(table.getByRole('button', { name: 'Show all 10 topics' }));
    expect(table.getAllByRole('row')).toHaveLength(11);
    expect(table.getByRole('button', { name: 'Show fewer' })).toBeInTheDocument();
  });

  it('shows average mastery per subject', async () => {
    await openDashboard();
    const subjects = screen.getByRole('region', { name: 'By subject' });
    expect(subjects).toHaveTextContent('Biology56% average mastery'); // Genetics (2 attempts) left out
    expect(subjects).toHaveTextContent('Chemistry56% average mastery');
    expect(subjects).toHaveTextContent('Physics60% average mastery'); // Optics (3 attempts) left out
  });

  it('greets by time of day', () => {
    expect(greeting(9)).toBe('Good morning');
    expect(greeting(14)).toBe('Good afternoon');
    expect(greeting(20)).toBe('Good evening');
  });
});
