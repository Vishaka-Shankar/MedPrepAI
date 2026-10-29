import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authApi } from './api/auth';
import { chatApi } from './api/chat';
import { tokenStorage } from './api/client';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';

vi.mock('./api/auth', () => ({
  authApi: { login: vi.fn(), register: vi.fn(), verifyOtp: vi.fn(), resendOtp: vi.fn(), me: vi.fn() },
}));
// The chat page loads its history on open; these tests are about routing, so it is just empty
vi.mock('./api/chat', () => ({ USE_MOCK: false, chatApi: { history: vi.fn(), ask: vi.fn() } }));
const mocked = vi.mocked(authApi);

const ayesha = { id: '1', name: 'Ayesha', email: 'ayesha@example.com', role: 'student' as const };

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

/** Builds the same error axios throws when NestJS answers with an error status. */
function httpError(status: number, data: Record<string, unknown>) {
  const headers = new AxiosHeaders();
  return new AxiosError('Request failed', String(status), { headers }, null, {
    status,
    statusText: 'Error',
    data,
    headers: {},
    config: { headers },
  });
}
const http401 = (message: string) => httpError(401, { message });

describe('routing and auth', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(chatApi.history).mockResolvedValue([]);
  });

  it('sends a logged-out user from a protected page to /login', async () => {
    renderAt('/dashboard');
    expect(await screen.findByRole('heading', { name: /log in/i })).toBeInTheDocument();
  });

  it('logs in and returns to the page the user wanted', async () => {
    mocked.login.mockResolvedValue({ accessToken: 'token-123', user: ayesha });
    renderAt('/dashboard');

    await userEvent.type(await screen.findByLabelText(/email/i), 'ayesha@example.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'secret123');
    await userEvent.click(screen.getByRole('button', { name: /log in/i }));

    expect(await screen.findByRole('heading', { name: /^Good (morning|afternoon|evening), Ayesha$/ })).toBeInTheDocument();
    expect(mocked.login).toHaveBeenCalledWith({ email: 'ayesha@example.com', password: 'secret123' });
    expect(tokenStorage.get()).toBe('token-123');
    // The sidebar shows all five sections, with the current one marked
    const nav = screen.getByRole('navigation', { name: 'Main' });
    for (const link of ['Chat', 'Quiz', 'Videos', 'Dashboard', 'Feedback']) {
      expect(within(nav).getByRole('link', { name: link })).toBeInTheDocument();
    }
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
  });

  it('shows the study priorities on the dashboard, ranked by weightage x (1 - mastery)', async () => {
    tokenStorage.set('saved-token');
    mocked.me.mockResolvedValue(ayesha);
    renderAt('/dashboard');

    const priorities = await screen.findByRole('region', { name: 'Study priorities' });
    const items = within(priorities).getAllByRole('listitem');
    expect(items.map((li) => li.querySelector('strong')?.textContent)).toEqual([
      '1. Cell biology',
      '2. Equilibrium',
      '3. Electrostatics',
    ]);
    expect(screen.getByText(/Practice Cell biology: your top priority topic/)).toBeInTheDocument();
  });

  it('shows "Coming soon" for Videos and Feedback, and sends unknown pages to the chat', async () => {
    tokenStorage.set('saved-token');
    mocked.me.mockResolvedValue(ayesha);
    renderAt('/videos');
    expect(await screen.findByRole('heading', { name: 'Videos' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Coming soon' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Feedback' }));
    expect(await screen.findByRole('heading', { name: 'Feedback' })).toBeInTheDocument();
  });

  it('redirects an unknown address to /chat', async () => {
    tokenStorage.set('saved-token');
    mocked.me.mockResolvedValue(ayesha);
    renderAt('/no-such-page');
    expect(await screen.findByRole('heading', { name: 'Ask the syllabus' })).toBeInTheDocument();
  });

  it('shows the server error when login fails', async () => {
    mocked.login.mockRejectedValue(http401('Invalid email or password'));
    renderAt('/login');

    await userEvent.type(await screen.findByLabelText(/email/i), 'ayesha@example.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong123');
    await userEvent.click(screen.getByRole('button', { name: /log in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(tokenStorage.get()).toBeNull();
  });

  it('restores the session from a saved token on page load', async () => {
    tokenStorage.set('saved-token');
    mocked.me.mockResolvedValue(ayesha);
    renderAt('/chat');

    expect(await screen.findByRole('heading', { name: 'Ask the syllabus' })).toBeInTheDocument();
    expect(screen.getByText('Ayesha')).toBeInTheDocument();
  });

  it('drops an expired saved token and shows the login page', async () => {
    tokenStorage.set('expired-token');
    mocked.me.mockRejectedValue(http401('Unauthorized'));
    renderAt('/chat');

    expect(await screen.findByRole('heading', { name: /log in/i })).toBeInTheDocument();
    expect(tokenStorage.get()).toBeNull();
  });

  it('logs out and returns to the login page', async () => {
    tokenStorage.set('saved-token');
    mocked.me.mockResolvedValue(ayesha);
    renderAt('/chat');

    // Two Log out buttons exist (sidebar + phone header); CSS shows only one of them at a time
    const [logoutButton] = await screen.findAllByRole('button', { name: /log out/i });
    await userEvent.click(logoutButton);
    await waitFor(() => expect(screen.getByRole('heading', { name: /log in/i })).toBeInTheDocument());
    expect(tokenStorage.get()).toBeNull();
  });

  it('registers, asks for the emailed code (no login yet), then opens the chat page', async () => {
    mocked.register.mockResolvedValue({
      message: 'Account created. We sent a 6-digit code to your email.',
      email: 'ayesha@example.com',
    });
    mocked.verifyOtp.mockResolvedValue({ accessToken: 'new-token', user: { ...ayesha, emailVerified: true } });
    renderAt('/register');

    await userEvent.type(await screen.findByLabelText(/^name/i), 'Ayesha');
    await userEvent.type(screen.getByLabelText(/^email/i), 'ayesha@example.com');
    await userEvent.type(screen.getByLabelText(/^password/i), 'secret123');
    await userEvent.type(screen.getByLabelText(/confirm password/i), 'secret123');
    await userEvent.click(screen.getByRole('button', { name: /register/i }));

    // The verify page, not the chat: there is no token until the code is checked
    expect(await screen.findByRole('heading', { name: 'Verify your email' })).toBeInTheDocument();
    expect(screen.getByText('ayesha@example.com')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('We sent a 6-digit code');
    expect(tokenStorage.get()).toBeNull();

    await userEvent.type(screen.getByLabelText('Digit 1 of 6'), '123456'); // auto-advances through the boxes
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByRole('heading', { name: 'Ask the syllabus' })).toBeInTheDocument();
    expect(mocked.verifyOtp).toHaveBeenCalledWith({ email: 'ayesha@example.com', code: '123456' });
    expect(tokenStorage.get()).toBe('new-token');
  });

  it('sends an unverified user from login to the verify page (403 EMAIL_NOT_VERIFIED)', async () => {
    mocked.login.mockRejectedValue(
      httpError(403, {
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Please verify your email first. We sent a code to your inbox.',
        email: 'ayesha@example.com',
      }),
    );
    renderAt('/login');

    await userEvent.type(await screen.findByLabelText(/email/i), 'Ayesha@Example.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'secret123');
    await userEvent.click(screen.getByRole('button', { name: /log in/i }));

    expect(await screen.findByRole('heading', { name: 'Verify your email' })).toBeInTheDocument();
    // The email as the server stores it, and its message shown as a notice rather than an error
    expect(screen.getByText('ayesha@example.com')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Please verify your email first');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(tokenStorage.get()).toBeNull();
  });

  it('after verifying, takes an unverified user to the page they first asked for', async () => {
    mocked.login.mockRejectedValue(
      httpError(403, { code: 'EMAIL_NOT_VERIFIED', message: 'Verify first', email: 'ayesha@example.com' }),
    );
    mocked.verifyOtp.mockResolvedValue({ accessToken: 'token-9', user: ayesha });
    renderAt('/dashboard');

    await userEvent.type(await screen.findByLabelText(/email/i), 'ayesha@example.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'secret123');
    await userEvent.click(screen.getByRole('button', { name: /log in/i }));
    await userEvent.type(await screen.findByLabelText('Digit 1 of 6'), '654321');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByRole('region', { name: 'Study priorities' })).toBeInTheDocument();
  });

  it('shows "database not reachable" on login as a message to retry, and the form still works', async () => {
    mocked.login
      .mockRejectedValueOnce(
        httpError(503, { message: 'The database is not reachable right now. Please try again in a minute.' }),
      )
      .mockResolvedValueOnce({ accessToken: 'token-123', user: ayesha });
    renderAt('/login');

    await userEvent.type(await screen.findByLabelText(/email/i), 'ayesha@example.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'secret123');
    await userEvent.click(screen.getByRole('button', { name: /log in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The database is not reachable right now. Please try again in a minute.',
    );

    await userEvent.click(screen.getByRole('button', { name: /log in/i }));
    expect(await screen.findByRole('heading', { name: 'Ask the syllabus' })).toBeInTheDocument();
  });

  it('shows a friendly sentence for 429 instead of the throttler text', async () => {
    mocked.login.mockRejectedValue(httpError(429, { message: 'ThrottlerException: Too Many Requests' }));
    renderAt('/login');

    await userEvent.type(await screen.findByLabelText(/email/i), 'ayesha@example.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'secret123');
    await userEvent.click(screen.getByRole('button', { name: /log in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Please wait a minute and try again.');
  });
});
