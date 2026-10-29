import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authApi, User } from '../api/auth';
import { tokenStorage } from '../api/client';
import { usersApi } from '../api/users';
import { App } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { DB_DOWN, httpError } from '../test/http';

vi.mock('../api/auth', () => ({
  authApi: { login: vi.fn(), register: vi.fn(), verifyOtp: vi.fn(), resendOtp: vi.fn(), me: vi.fn(), forgotPassword: vi.fn(), resetPassword: vi.fn() },
}));
vi.mock('../api/users', () => ({
  ASSIGNABLE_ROLES: ['student', 'admin'],
  usersApi: {
    me: vi.fn(),
    updateProfile: vi.fn(),
    changePassword: vi.fn(),
    requestEmailChange: vi.fn(),
    confirmEmailChange: vi.fn(),
    deleteMe: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    setRole: vi.fn(),
    remove: vi.fn(),
  },
}));
vi.mock('../api/chat', () => ({ USE_MOCK: false, chatApi: { history: vi.fn().mockResolvedValue([]), ask: vi.fn() } }));
const users = vi.mocked(usersApi);

const ayesha: User = { id: 'u1', name: 'Ayesha Khan', email: 'ayesha@example.com', role: 'student', emailVerified: true };
const WRONG_PASSWORD = httpError(403, { code: 'WRONG_PASSWORD', message: 'Your password is incorrect' });

/** Logged in as Ayesha (a saved token that /auth/me accepts), on the Profile page. */
async function openProfile() {
  tokenStorage.set('old-token');
  vi.mocked(authApi.me).mockResolvedValue(ayesha);
  render(
    <MemoryRouter initialEntries={['/profile']}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { name: 'Profile' });
}

const section = (name: string) => screen.getByRole('region', { name });

beforeEach(() => vi.clearAllMocks());

describe('Profile page', () => {
  it('is linked from the sidebar and shows name, email and role', async () => {
    await openProfile();
    const account = screen.getByRole('navigation', { name: 'Account' });
    expect(within(account).getByRole('link', { name: 'Profile' })).toHaveAttribute('aria-current', 'page');

    const details = section('Your details');
    expect(within(details).getByText('ayesha@example.com')).toBeInTheDocument();
    expect(within(details).getByText('Student')).toBeInTheDocument();
  });

  it('edits the name, and the sidebar shows the new one', async () => {
    const user = userEvent.setup();
    users.updateProfile.mockResolvedValue({ ...ayesha, name: 'Ayesha K.' });
    await openProfile();

    const name = within(section('Your details')).getByLabelText('Name');
    await user.clear(name);
    await user.type(name, '  Ayesha K. ');
    await user.click(screen.getByRole('button', { name: 'Save name' }));

    expect(users.updateProfile).toHaveBeenCalledWith({ name: 'Ayesha K.' });
    expect(await screen.findByText('Your name has been updated.')).toBeInTheDocument();
    expect(screen.getAllByText('Ayesha K.').length).toBeGreaterThanOrEqual(2); // details list + sidebar
  });
});

describe('Change password', () => {
  async function fill(user: ReturnType<typeof userEvent.setup>, current: string, next: string, confirm = next) {
    const form = section('Change password');
    await user.type(within(form).getByLabelText('Current password'), current);
    await user.type(within(form).getByLabelText('New password'), next);
    await user.type(within(form).getByLabelText('Confirm new password'), confirm);
    await user.click(within(form).getByRole('button', { name: 'Change password' }));
  }

  it('on success saves the fresh token, clears the fields and says other devices were logged out', async () => {
    const user = userEvent.setup();
    users.changePassword.mockResolvedValue({ message: 'Password changed. You were logged out on other devices.', accessToken: 'new-token' });
    await openProfile();

    await fill(user, 'secret123', 'brandnew9');

    expect(users.changePassword).toHaveBeenCalledWith({ currentPassword: 'secret123', newPassword: 'brandnew9' });
    expect(await screen.findByText('Password changed. You were logged out on other devices.')).toBeInTheDocument();
    expect(tokenStorage.get()).toBe('new-token');
    expect(within(section('Change password')).getByLabelText('Current password')).toHaveValue('');
  });

  it('a wrong current password (403) is shown on that field, and the user stays logged in', async () => {
    const user = userEvent.setup();
    users.changePassword.mockRejectedValue(WRONG_PASSWORD);
    await openProfile();

    await fill(user, 'wrong1234', 'brandnew9');

    const current = await within(section('Change password')).findByLabelText('Current password');
    expect(current).toHaveAttribute('aria-invalid', 'true');
    expect(current).toHaveAccessibleDescription('Your current password is incorrect.');
    expect(tokenStorage.get()).toBe('old-token');
    expect(screen.getByRole('heading', { name: 'Profile' })).toBeInTheDocument();
  });

  it('refuses reusing the current password and a weak password before calling the server', async () => {
    const user = userEvent.setup();
    await openProfile();
    const form = section('Change password');

    await fill(user, 'secret123', 'secret123');
    expect(within(form).getByLabelText('New password')).toHaveAccessibleDescription(/must be different from your current password/);

    await user.clear(within(form).getByLabelText('New password'));
    await user.type(within(form).getByLabelText('New password'), 'short1');
    await user.click(within(form).getByRole('button', { name: 'Change password' }));
    expect(within(form).getByLabelText('New password')).toHaveAccessibleDescription(/8 to 72 characters/);
    expect(users.changePassword).not.toHaveBeenCalled();
  });

  it('disables the button while saving', async () => {
    const user = userEvent.setup();
    users.changePassword.mockReturnValue(new Promise(() => {})); // never answers
    await openProfile();
    await fill(user, 'secret123', 'brandnew9');
    expect(within(section('Change password')).getByRole('button', { name: 'Changing...' })).toBeDisabled();
  });

  it('a 401 (password changed on another device) logs out with the server reason', async () => {
    const user = userEvent.setup();
    const reason = 'Your session has ended because the password was changed. Please log in again.';
    users.changePassword.mockRejectedValue(httpError(401, { message: reason }));
    await openProfile();

    await fill(user, 'secret123', 'brandnew9');

    expect(await screen.findByRole('heading', { name: 'Log in to MedPrep AI' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(reason);
    expect(tokenStorage.get()).toBeNull();
  });
});

describe('Change email', () => {
  it('409 is shown on the email field; then the code is sent to the new address and confirmed', async () => {
    const user = userEvent.setup();
    users.requestEmailChange
      .mockRejectedValueOnce(httpError(409, { message: 'An account with this email already exists' }))
      .mockResolvedValueOnce({ message: 'We sent a 6-digit code to your new email address.', email: 'new@example.com' });
    users.confirmEmailChange.mockResolvedValue({ message: 'Your email address has been changed.', user: { ...ayesha, email: 'new@example.com' } });
    await openProfile();
    const form = section('Change email');

    await user.type(within(form).getByLabelText('New email'), 'taken@example.com');
    await user.type(within(form).getByLabelText('Password'), 'secret123');
    await user.click(within(form).getByRole('button', { name: 'Send code' }));
    expect(await within(form).findByLabelText('New email')).toHaveAccessibleDescription(/already used by another account/);

    await user.clear(within(form).getByLabelText('New email'));
    await user.type(within(form).getByLabelText('New email'), 'New@Example.com');
    await user.click(within(form).getByRole('button', { name: 'Send code' }));
    expect(users.requestEmailChange).toHaveBeenLastCalledWith({ newEmail: 'New@Example.com', password: 'secret123' });

    await within(form).findByRole('group', { name: 'Verification code' });
    expect(within(form).getByText('new@example.com')).toBeInTheDocument();
    await user.paste('654321');
    await user.click(within(form).getByRole('button', { name: 'Confirm new email' }));

    expect(users.confirmEmailChange).toHaveBeenCalledWith({ code: '654321' });
    expect(await within(form).findByRole('status')).toHaveTextContent('Your email address has been changed.');
    expect(within(section('Your details')).getByText('new@example.com')).toBeInTheDocument();
  });
});

describe('Delete account dialog', () => {
  const openDialog = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(within(section('Delete account')).getByRole('button', { name: 'Delete account' }));
    return screen.getByRole('dialog', { name: 'Delete your account?' });
  };

  it('opens with the cursor in the password box; Cancel and Escape close it without deleting', async () => {
    const user = userEvent.setup();
    await openProfile();

    let dialog = await openDialog(user);
    expect(within(dialog).getByLabelText('Password')).toHaveFocus();
    expect(within(dialog).getByRole('button', { name: 'Delete my account' })).toBeDisabled(); // no password yet
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Focus goes back to the button that opened it
    expect(within(section('Delete account')).getByRole('button', { name: 'Delete account' })).toHaveFocus();

    dialog = await openDialog(user);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(users.deleteMe).not.toHaveBeenCalled();
  });

  it('a wrong password keeps the dialog open with the error on the field; nothing is deleted', async () => {
    const user = userEvent.setup();
    users.deleteMe.mockRejectedValue(WRONG_PASSWORD);
    await openProfile();

    const dialog = await openDialog(user);
    await user.type(within(dialog).getByLabelText('Password'), 'wrong1234{Enter}'); // Enter confirms
    expect(await within(dialog).findByLabelText('Password')).toHaveAccessibleDescription('Your password is incorrect.');
    expect(tokenStorage.get()).toBe('old-token');
  });

  it('503 shows the database message inside the dialog so the user can retry', async () => {
    const user = userEvent.setup();
    users.deleteMe.mockRejectedValue(httpError(503, { message: DB_DOWN }));
    await openProfile();

    const dialog = await openDialog(user);
    await user.type(within(dialog).getByLabelText('Password'), 'secret123');
    await user.click(within(dialog).getByRole('button', { name: 'Delete my account' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(DB_DOWN);
    expect(within(dialog).getByRole('button', { name: 'Delete my account' })).toBeEnabled();
  });

  it('on success clears the token and opens Register with a notice', async () => {
    const user = userEvent.setup();
    users.deleteMe.mockResolvedValue({ message: 'Your account and its data have been deleted.' });
    await openProfile();

    const dialog = await openDialog(user);
    await user.type(within(dialog).getByLabelText('Password'), 'secret123');
    await user.click(within(dialog).getByRole('button', { name: 'Delete my account' }));

    expect(users.deleteMe).toHaveBeenCalledWith({ password: 'secret123' });
    expect(await screen.findByRole('heading', { name: 'Create your account' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Your account has been deleted.');
    expect(tokenStorage.get()).toBeNull();
  });
});
