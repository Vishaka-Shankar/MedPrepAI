import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authApi } from '../api/auth';
import { App } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { DB_DOWN, httpError } from '../test/http';

vi.mock('../api/auth', () => ({
  authApi: {
    login: vi.fn(),
    register: vi.fn(),
    verifyOtp: vi.fn(),
    resendOtp: vi.fn(),
    me: vi.fn(),
    forgotPassword: vi.fn(),
    resetPassword: vi.fn(),
  },
}));
const mocked = vi.mocked(authApi);

const GENERIC = 'If an account exists for this email, we sent a password reset code. It expires in 10 minutes.';
const RESET_DONE = 'Your password has been reset. Please log in with your new password.';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

type User = ReturnType<typeof userEvent.setup>;

/** Step 1 done: the email was sent and the code + new password form is showing. */
async function reachResetStep(user: User) {
  mocked.forgotPassword.mockResolvedValue({ message: GENERIC });
  renderAt('/forgot-password');
  await user.type(await screen.findByLabelText('Email'), 'Ayesha@Example.com');
  await user.click(screen.getByRole('button', { name: 'Send code' }));
  await screen.findByRole('group', { name: 'Verification code' });
}

async function fillReset(user: User, code: string, password = 'brandnew9', confirm = password) {
  await user.click(screen.getByLabelText('Digit 1 of 6'));
  await user.paste(code);
  await user.type(screen.getByLabelText('New password'), password);
  await user.type(screen.getByLabelText('Confirm new password'), confirm);
  await user.click(screen.getByRole('button', { name: 'Reset password' }));
}

beforeEach(() => vi.resetAllMocks());

describe('Forgot password', () => {
  it('Login has a "Forgot password?" link to the reset page', async () => {
    const user = userEvent.setup();
    renderAt('/login');
    await user.click(await screen.findByRole('link', { name: 'Forgot password?' }));
    expect(screen.getByRole('heading', { name: 'Reset your password' })).toBeInTheDocument();
  });

  it('email -> code + new password -> back to Login with the success message and the email filled in', async () => {
    const user = userEvent.setup();
    mocked.resetPassword.mockResolvedValue({ message: RESET_DONE });
    await reachResetStep(user);

    expect(mocked.forgotPassword).toHaveBeenCalledWith({ email: 'Ayesha@Example.com' });
    // The server's generic answer is shown as-is (it never says whether the account exists)
    expect(screen.getByRole('status')).toHaveTextContent(GENERIC);

    await fillReset(user, '123456');

    expect(mocked.resetPassword).toHaveBeenCalledWith({ email: 'Ayesha@Example.com', code: '123456', newPassword: 'brandnew9' });
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(RESET_DONE);
    expect(screen.getByLabelText('Email')).toHaveValue('ayesha@example.com');
  });

  it('checks the new password before sending, with the error tied to its input', async () => {
    const user = userEvent.setup();
    await reachResetStep(user);

    await fillReset(user, '123456', 'onlyletters');
    expect(screen.getByLabelText('New password')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('New password')).toHaveAccessibleDescription(/must contain a letter and a number/);

    await user.clear(screen.getByLabelText('New password'));
    await user.type(screen.getByLabelText('New password'), 'brandnew9');
    await user.clear(screen.getByLabelText('Confirm new password'));
    await user.type(screen.getByLabelText('Confirm new password'), 'brandnew8');
    await user.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(screen.getByLabelText('Confirm new password')).toHaveAccessibleDescription('Passwords do not match.');
    expect(mocked.resetPassword).not.toHaveBeenCalled();
  });

  it('a wrong code shows the attempts left and empties the boxes; an expired code says how to get a new one', async () => {
    const user = userEvent.setup();
    mocked.resetPassword
      .mockRejectedValueOnce(httpError(400, { code: 'OTP_WRONG', message: 'Incorrect code. 4 attempt(s) left.', attemptsLeft: 4 }))
      .mockRejectedValueOnce(httpError(400, { code: 'OTP_EXPIRED', message: 'This code has expired. Request a new one.' }));
    await reachResetStep(user);

    await fillReset(user, '111111');
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect code. 4 attempt(s) left.');
    expect(screen.getByLabelText('Digit 1 of 6')).toHaveValue('');

    await user.paste('222222');
    await user.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This code has expired. Press "Send a new code"');
  });

  it('503: shows "database not reachable" and keeps everything, so pressing the button again works', async () => {
    const user = userEvent.setup();
    mocked.resetPassword.mockRejectedValueOnce(httpError(503, { message: DB_DOWN })).mockResolvedValueOnce({ message: RESET_DONE });
    await reachResetStep(user);

    await fillReset(user, '123456');
    expect(await screen.findByRole('alert')).toHaveTextContent(DB_DOWN);
    expect(screen.getByLabelText('Digit 6 of 6')).toHaveValue('6');

    await user.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  });

  it('429 on "Send code" becomes a friendly sentence and the button works again', async () => {
    const user = userEvent.setup();
    mocked.forgotPassword.mockRejectedValue(httpError(429, { message: 'ThrottlerException: Too Many Requests' }));
    renderAt('/forgot-password');

    await user.type(await screen.findByLabelText('Email'), 'ayesha@example.com');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Please wait a minute and try again.');
    expect(screen.getByRole('button', { name: 'Send code' })).toBeEnabled();
  });

  it('rejects an invalid email without calling the server', async () => {
    const user = userEvent.setup();
    renderAt('/forgot-password');
    await user.type(await screen.findByLabelText('Email'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription('Please enter a valid email address.');
    expect(mocked.forgotPassword).not.toHaveBeenCalled();
  });
});
