import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authApi, User } from '../api/auth';
import { tokenStorage } from '../api/client';
import { UserPage, usersApi } from '../api/users';
import { App } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { DB_DOWN, httpError } from '../test/http';
import { PAGE_SIZE } from './AdminUsersPage';

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

const admin: User = { id: 'a1', name: 'Sadia Admin', email: 'admin@example.com', role: 'admin', emailVerified: true };
const ayesha: User = { id: 'u1', name: 'Ayesha Khan', email: 'ayesha@example.com', role: 'student', emailVerified: true };
const bilal: User = { id: 'u2', name: 'Bilal Ahmed', email: 'bilal@example.com', role: 'student', emailVerified: false };

const pageOf = (items: User[], page = 1, total = items.length): UserPage => ({
  items,
  page,
  limit: PAGE_SIZE,
  total,
  totalPages: Math.ceil(total / PAGE_SIZE),
});

function openAs(user: User, path: string) {
  tokenStorage.set('token');
  vi.mocked(authApi.me).mockResolvedValue(user);
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

const row = (name: string) => screen.getByRole('cell', { name: new RegExp(`^${name}`) }).closest('tr') as HTMLElement;

beforeEach(() => vi.clearAllMocks());

describe('admin role guard', () => {
  it('a student sees no Admin link and is sent away from /admin/users without any API call', async () => {
    openAs(ayesha, '/admin/users');

    expect(await screen.findByRole('heading', { name: 'Ask the syllabus' })).toBeInTheDocument(); // the chat page
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
    expect(users.list).not.toHaveBeenCalled();
  });

  it('an admin sees the Admin link and the users table', async () => {
    users.list.mockResolvedValue(pageOf([admin, ayesha, bilal]));
    openAs(admin, '/chat');

    const user = userEvent.setup();
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    await user.click(within(nav).getByRole('link', { name: 'Admin' }));

    expect(await screen.findByRole('heading', { name: 'Users' })).toBeInTheDocument();
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(users.list).toHaveBeenCalledWith({ page: 1, limit: PAGE_SIZE, search: '' });
  });
});

describe('admin users table', () => {
  it("disables the role dropdown and Delete on the admin's own row only", async () => {
    users.list.mockResolvedValue(pageOf([admin, ayesha]));
    openAs(admin, '/admin/users');
    await screen.findByRole('table');

    expect(within(row('Sadia Admin')).getByText('(you)')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Role for Sadia Admin' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete Sadia Admin' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete Sadia Admin' })).toHaveAccessibleDescription(/cannot change your own role/);

    expect(screen.getByRole('combobox', { name: 'Role for Ayesha Khan' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Delete Ayesha Khan' })).toBeEnabled();
  });

  it('changes a role from the dropdown', async () => {
    const user = userEvent.setup();
    users.list.mockResolvedValue(pageOf([admin, ayesha]));
    users.setRole.mockResolvedValue({ ...ayesha, role: 'admin' });
    openAs(admin, '/admin/users');

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Role for Ayesha Khan' }), 'admin');

    expect(users.setRole).toHaveBeenCalledWith('u1', 'admin');
    expect(await screen.findByRole('status')).toHaveTextContent('Ayesha Khan is now an admin.');
    expect(screen.getByRole('combobox', { name: 'Role for Ayesha Khan' })).toHaveValue('admin');
  });

  it('deletes only after confirming, then reloads the page', async () => {
    const user = userEvent.setup();
    users.list.mockResolvedValueOnce(pageOf([admin, ayesha, bilal])).mockResolvedValueOnce(pageOf([admin, ayesha]));
    users.remove.mockResolvedValue({ message: 'User and their data deleted.' });
    openAs(admin, '/admin/users');

    await user.click(await screen.findByRole('button', { name: 'Delete Bilal Ahmed' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete Bilal Ahmed?' });
    expect(within(dialog).getByText('bilal@example.com')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(users.remove).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete Bilal Ahmed' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete user' }));

    expect(users.remove).toHaveBeenCalledWith('u2');
    expect(await screen.findByRole('status')).toHaveTextContent('Bilal Ahmed and their data were deleted.');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete Bilal Ahmed' })).not.toBeInTheDocument());
    expect(users.list).toHaveBeenCalledTimes(2);
  });

  it('searches from page 1 and pages with Next / Previous', async () => {
    const user = userEvent.setup();
    users.list.mockImplementation(async ({ page }) => pageOf([page === 1 ? ayesha : bilal], page, PAGE_SIZE + 1));
    openAs(admin, '/admin/users');

    const pagination = await screen.findByRole('navigation', { name: 'Pagination' });
    expect(within(pagination).getByText(`Page 1 of 2 (${PAGE_SIZE + 1} users)`)).toBeInTheDocument();
    expect(within(pagination).getByRole('button', { name: 'Previous' })).toBeDisabled();

    await user.click(within(pagination).getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('cell', { name: 'Bilal Ahmed' })).toBeInTheDocument();
    expect(users.list).toHaveBeenLastCalledWith({ page: 2, limit: PAGE_SIZE, search: '' });

    await user.type(screen.getByRole('searchbox', { name: 'Search by name or email' }), ' bilal ');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(users.list).toHaveBeenLastCalledWith({ page: 1, limit: PAGE_SIZE, search: 'bilal' });
  });

  it('503 while loading shows the database message with a working "Try again"', async () => {
    const user = userEvent.setup();
    users.list.mockRejectedValueOnce(httpError(503, { message: DB_DOWN })).mockResolvedValueOnce(pageOf([admin, ayesha]));
    openAs(admin, '/admin/users');

    expect(await screen.findByRole('alert')).toHaveTextContent(DB_DOWN);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });
});
