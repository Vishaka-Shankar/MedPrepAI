import { render, screen, within } from '@testing-library/react';
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

  it('shows the three top cards: next up, accuracy and topics practised', async () => {
    await openDashboard();
    expect(screen.getByText('Practice Cell biology: your top priority topic')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start 10 questions' })).toHaveAttribute('href', '/quiz');
    expect(screen.getByRole('region', { name: 'Accuracy' })).toHaveTextContent('64%');
    expect(screen.getByRole('region', { name: 'Accuracy' })).toHaveTextContent('128 attempts');
    expect(screen.getByRole('region', { name: 'Topics practised' })).toHaveTextContent('14');
    expect(screen.getByRole('region', { name: 'Topics practised' })).toHaveTextContent('across 3 subjects');
  });

  it('colours mastery tiles by the helper and marks topics with too few attempts', async () => {
    await openDashboard();
    const tiles = within(screen.getByRole('list', { name: 'Topics' })).getAllByRole('listitem');
    const byName = (name: string) => tiles.find((t) => t.textContent?.startsWith(name))!;

    expect(byName('Cell biology')).toHaveAttribute('data-tone', 'amber'); // 0.40
    expect(byName('Bioenergetics')).toHaveAttribute('data-tone', 'light-teal'); // 0.55
    expect(byName('Kinematics')).toHaveAttribute('data-tone', 'strong-teal'); // exactly 0.70
    expect(byName('Genetics')).toHaveAttribute('data-tone', 'insufficient'); // 2 attempts
    expect(byName('Genetics')).toHaveTextContent('Insufficient data');
    expect(byName('Cell biology')).toHaveTextContent('0.40 mastery, Weak'); // words, not only colour
  });

  it('lists the top 3 study priorities computed from the data, with score and reason', async () => {
    await openDashboard();
    const card = screen.getByRole('region', { name: 'Study priorities' });
    const items = within(card).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      '1. Cell biology 0.018Heavily tested, mastery low',
      '2. Equilibrium 0.016Heavily tested, mastery low',
      '3. Electrostatics 0.011Moderately tested, mastery low',
    ]);
    expect(within(card).getByRole('link', { name: 'Practice top 3' })).toHaveAttribute('href', '/quiz');
  });

  it('greets by time of day', () => {
    expect(greeting(9)).toBe('Good morning');
    expect(greeting(14)).toBe('Good afternoon');
    expect(greeting(20)).toBe('Good evening');
  });
});
