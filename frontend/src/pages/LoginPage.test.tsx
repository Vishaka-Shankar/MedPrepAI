import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authApi } from '../api/auth';
import { AuthProvider } from '../auth/AuthContext';
import { LoginPage } from './LoginPage';

vi.mock('../api/auth', () => ({
  authApi: {
    login: vi.fn(),
    verifyLogin: vi.fn(),
    resendLogin: vi.fn(),
    register: vi.fn(),
    verifyOtp: vi.fn(),
    resendOtp: vi.fn(),
    me: vi.fn(),
  },
}));
const mocked = vi.mocked(authApi);

/** Stand-in for the code screen: shows the state the login page passed along. */
function CodeScreen() {
  return <pre data-testid="state">{JSON.stringify(useLocation().state)}</pre>;
}

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/verify-otp" element={<CodeScreen />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

async function logIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Email'), 'ayesha@example.com');
  await user.type(screen.getByLabelText('Password'), 'secret123');
  await user.click(screen.getByRole('button', { name: 'Log in' }));
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
});

describe('LoginPage', () => {
  it('two-step login: the right password opens the login code screen, with no token saved yet', async () => {
    mocked.login.mockResolvedValue({
      twoFactorRequired: true,
      email: 'ayesha@example.com',
      message: 'We sent a 6-digit login code to your email. It expires in 10 minutes.',
    });
    const user = userEvent.setup();
    renderLogin();

    await logIn(user);
    const state = JSON.parse((await screen.findByTestId('state')).textContent ?? '{}');
    expect(state).toMatchObject({ email: 'ayesha@example.com', purpose: 'login', notice: expect.stringContaining('login code') });
    expect(mocked.login).toHaveBeenCalledWith({ email: 'ayesha@example.com', password: 'secret123' });
    expect(localStorage.getItem('medprep_token')).toBeNull();
  });

  it('with two-step login turned off, the password alone logs in', async () => {
    mocked.login.mockResolvedValue({
      accessToken: 'token-1',
      user: { id: '1', name: 'Ayesha', email: 'ayesha@example.com', role: 'student' },
    });
    const user = userEvent.setup();
    renderLogin();

    await logIn(user);
    await vi.waitFor(() => expect(localStorage.getItem('medprep_token')).toBe('token-1'));
    expect(screen.queryByTestId('state')).not.toBeInTheDocument();
  });
});
