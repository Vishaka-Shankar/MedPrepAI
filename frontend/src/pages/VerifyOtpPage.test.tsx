import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authApi } from '../api/auth';
import { AuthProvider } from '../auth/AuthContext';
import { VerifyOtpPage, VerifyOtpState } from './VerifyOtpPage';

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

const RESEND_MESSAGE = 'If this email needs verification, a new code is on its way. You can ask again after 60 seconds.';

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

function renderPage(state: VerifyOtpState | null = { email: 'ayesha@example.com' }) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/verify-otp', state }]}>
      <AuthProvider>
        <Routes>
          <Route path="/verify-otp" element={<VerifyOtpPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

const resendButton = () => screen.getByRole('button', { name: /resend code/i });

async function enterCode(user: ReturnType<typeof userEvent.setup>, code: string) {
  await user.click(screen.getByLabelText('Digit 1 of 6'));
  await user.paste(code);
  await user.click(screen.getByRole('button', { name: 'Verify' }));
}

beforeEach(() => vi.resetAllMocks());

describe('VerifyOtpPage resend countdown', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it('locks "Resend code" for 60 s, then sends a new code and starts the countdown again', async () => {
    mocked.resendOtp.mockResolvedValue({ message: RESEND_MESSAGE });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPage();

    // A code was just sent, so resending is blocked at first
    expect(resendButton()).toBeDisabled();
    expect(resendButton()).toHaveTextContent('Resend code (60s)');
    expect(screen.getByText(/expires 10 minutes after it is sent/)).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(15_000));
    expect(resendButton()).toHaveTextContent('Resend code (45s)');

    act(() => vi.advanceTimersByTime(45_000));
    expect(resendButton()).toBeEnabled();
    expect(resendButton()).toHaveTextContent(/^Resend code$/);

    await user.click(resendButton());
    expect(mocked.resendOtp).toHaveBeenCalledWith({ email: 'ayesha@example.com' });
    expect(await screen.findByRole('status')).toHaveTextContent(RESEND_MESSAGE);
    expect(resendButton()).toBeDisabled();
    expect(resendButton()).toHaveTextContent('Resend code (60s)');
  });

  it('shows a friendly message when resend is rate limited (429) and lets the user try later', async () => {
    mocked.resendOtp.mockRejectedValue(httpError(429, { message: 'ThrottlerException: Too Many Requests' }));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPage();

    act(() => vi.advanceTimersByTime(60_000));
    await user.click(resendButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Please wait a minute and try again.');
    expect(resendButton()).toBeEnabled();
  });
});

describe('VerifyOtpPage errors', () => {
  it.each([
    ['OTP_WRONG', 'Incorrect code. 3 attempt(s) left.', 'Incorrect code. 3 attempt(s) left.'],
    ['OTP_EXPIRED', 'This code has expired. Request a new one.', 'This code has expired. Press "Resend code"'],
    ['OTP_LOCKED', 'Too many wrong attempts. Request a new code.', 'Too many wrong attempts, so this code is locked'],
    ['OTP_INVALID', 'Invalid or expired code. Request a new one.', 'This code is no longer valid'],
  ])('%s: explains it and empties the boxes for a new code', async (code, serverMessage, shown) => {
    mocked.verifyOtp.mockRejectedValue(httpError(400, { statusCode: 400, code, message: serverMessage }));
    const user = userEvent.setup();
    renderPage();

    await enterCode(user, '111111');

    expect(await screen.findByRole('alert')).toHaveTextContent(shown);
    expect(screen.getByLabelText('Digit 1 of 6')).toHaveValue('');
    expect(screen.getByLabelText('Digit 1 of 6')).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Verify' })).toBeDisabled();
  });

  it('503 "database not reachable": keeps the digits so pressing Verify again just works', async () => {
    mocked.verifyOtp
      .mockRejectedValueOnce(
        httpError(503, { message: 'The database is not reachable right now. Please try again in a minute.' }),
      )
      .mockResolvedValueOnce({
        accessToken: 'token-1',
        user: { id: '1', name: 'Ayesha', email: 'ayesha@example.com', role: 'student' },
      });
    const user = userEvent.setup();
    renderPage();

    await enterCode(user, '123456');
    expect(await screen.findByRole('alert')).toHaveTextContent('The database is not reachable right now');
    expect(screen.getByLabelText('Digit 6 of 6')).toHaveValue('6');

    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(mocked.verifyOtp).toHaveBeenCalledTimes(2);
    expect(mocked.verifyOtp).toHaveBeenLastCalledWith({ email: 'ayesha@example.com', code: '123456' });
    expect(localStorage.getItem('medprep_token')).toBe('token-1');
  });

  it('opened without an email (e.g. a bookmark): explains how to get a code instead of crashing', () => {
    renderPage(null);
    expect(screen.getByRole('heading', { name: 'Verify your email' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Verification code' })).not.toBeInTheDocument();
  });
});

describe('VerifyOtpPage as the login code screen (two-step login)', () => {
  const loginState: VerifyOtpState = {
    email: 'ayesha@example.com',
    notice: 'We sent a 6-digit login code to your email. It expires in 10 minutes.',
    purpose: 'login',
  };

  it('checks the code with /auth/login/verify and logs the user in', async () => {
    mocked.verifyLogin.mockResolvedValue({
      accessToken: 'token-2fa',
      user: { id: '1', name: 'Ayesha', email: 'ayesha@example.com', role: 'student' },
    });
    const user = userEvent.setup();
    renderPage(loginState);

    expect(screen.getByRole('heading', { name: 'Enter your login code' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('We sent a 6-digit login code');
    await user.click(screen.getByLabelText('Digit 1 of 6'));
    await user.paste('654321');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(mocked.verifyLogin).toHaveBeenCalledWith({ email: 'ayesha@example.com', code: '654321' });
    expect(mocked.verifyOtp).not.toHaveBeenCalled();
    expect(localStorage.getItem('medprep_token')).toBe('token-2fa');
  });

  it('a locked login code tells the user to log in again', async () => {
    mocked.verifyLogin.mockRejectedValue(httpError(400, { code: 'OTP_LOCKED', message: 'Too many wrong attempts.' }));
    const user = userEvent.setup();
    renderPage(loginState);

    await user.click(screen.getByLabelText('Digit 1 of 6'));
    await user.paste('000000');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please log in again to get a new code.');
    expect(screen.getByRole('link', { name: 'Back to log in' })).toHaveAttribute('href', '/login');
  });

  describe('resend', () => {
    beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
    afterEach(() => vi.useRealTimers());

    it('asks /auth/login/resend for a new login code after 60 s', async () => {
      mocked.resendLogin.mockResolvedValue({ message: 'If a login is waiting for a code, a new one is on its way.' });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderPage(loginState);

      act(() => vi.advanceTimersByTime(60_000));
      await user.click(resendButton());
      expect(mocked.resendLogin).toHaveBeenCalledWith({ email: 'ayesha@example.com' });
      expect(mocked.resendOtp).not.toHaveBeenCalled();
      expect(await screen.findByRole('status')).toHaveTextContent('a new one is on its way');
    });
  });
});
