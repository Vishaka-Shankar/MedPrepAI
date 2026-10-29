import { FormEvent, useCallback, useEffect, useState } from 'react';
import { User } from '../api/auth';
import { ASSIGNABLE_ROLES, AssignableRole, UserPage, usersApi } from '../api/users';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { TextField } from '../components/ui/TextField';
import { useApiError } from '../hooks/useApiError';
import styles from './AdminUsersPage.module.css';
import { ROLE_LABELS } from './profile/ProfileDetails';

export const PAGE_SIZE = 10;
const SELF_NOTE = 'You cannot change your own role or delete your own account here.';

/**
 * /admin/users (admins only; RequireRole guards the route and the backend checks again).
 * One page of users from GET /users, with search, a role dropdown and delete per row.
 * The admin's own row is locked, matching the backend rule.
 */
export function AdminUsersPage() {
  const { user: me } = useAuth();
  const toMessage = useApiError();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState(''); // the search that was submitted
  const [data, setData] = useState<UserPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0); // +1 reloads the page

  const [pendingId, setPendingId] = useState<string | null>(null); // row with a role change in flight
  const [status, setStatus] = useState('');
  const [actionError, setActionError] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let current = true; // ignore an answer that arrives after a newer request
    setLoading(true);
    setLoadError('');
    usersApi
      .list({ page, limit: PAGE_SIZE, search })
      .then((result) => current && setData(result))
      .catch((err: unknown) => current && setLoadError(toMessage(err)))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [page, search, attempt, toMessage]);

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  function clearSearch() {
    setSearchInput('');
    setSearch('');
    setPage(1);
  }

  async function changeRole(target: User, role: AssignableRole) {
    setStatus('');
    setActionError('');
    setPendingId(target.id);
    try {
      const updated = await usersApi.setRole(target.id, role);
      setData((d) => d && { ...d, items: d.items.map((u) => (u.id === updated.id ? updated : u)) });
      setStatus(`${updated.name} is now ${role === 'admin' ? 'an admin' : 'a student'}.`);
    } catch (err) {
      setActionError(toMessage(err)); // the dropdown still shows the saved role
    } finally {
      setPendingId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || !data) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await usersApi.remove(deleteTarget.id);
      setStatus(`${deleteTarget.name} and their data were deleted.`);
      setActionError('');
      setDeleteTarget(null);
      // The last row of a later page is gone: show the page before it
      if (data.items.length === 1 && page > 1) setPage(page - 1);
      else reload();
    } catch (err) {
      setDeleteError(toMessage(err));
    } finally {
      setDeleting(false);
    }
  }

  const totalPages = Math.max(1, data?.totalPages ?? 1);

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Users</h1>

      <form role="search" className={styles.search} onSubmit={handleSearch}>
        <TextField
          className={styles.searchField}
          label="Search by name or email"
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          maxLength={100}
        />
        <Button type="submit" disabled={loading}>
          Search
        </Button>
        {search && (
          <Button variant="outline" onClick={clearSearch}>
            Clear
          </Button>
        )}
      </form>

      {status && (
        <p className={styles.status} role="status">
          {status}
        </p>
      )}
      {actionError && (
        <p className={styles.error} role="alert">
          {actionError}
        </p>
      )}

      <Card className={styles.tableCard}>
        {loadError ? (
          <div className={styles.message}>
            <p className={styles.error} role="alert">
              {loadError}
            </p>
            <Button variant="outline" onClick={reload}>
              Try again
            </Button>
          </div>
        ) : !data ? (
          <p className={styles.message} role="status">
            Loading users...
          </p>
        ) : data.items.length === 0 ? (
          <p className={styles.message}>{search ? `No users match "${search}".` : 'No users yet.'}</p>
        ) : (
          <div className={styles.scroll}>
            <table className={styles.table} aria-busy={loading}>
              <caption className="sr-only">
                Users, page {data.page} of {totalPages}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Verified</th>
                  <th scope="col">Role</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((u) => {
                  const isMe = u.id === me?.id;
                  const locked = isMe || pendingId === u.id || deleting;
                  return (
                    <tr key={u.id} className={isMe ? styles.meRow : undefined}>
                      <td>
                        {u.name}
                        {isMe && <span className={styles.you}> (you)</span>}
                      </td>
                      <td className={styles.email}>{u.email}</td>
                      <td>{u.emailVerified ? 'Yes' : 'No'}</td>
                      <td>
                        <select
                          className={styles.select}
                          aria-label={`Role for ${u.name}`}
                          aria-describedby={isMe ? 'self-note' : undefined}
                          value={u.role}
                          disabled={locked}
                          onChange={(e) => void changeRole(u, e.target.value as AssignableRole)}
                        >
                          {ASSIGNABLE_ROLES.map((role) => (
                            <option key={role} value={role}>
                              {ROLE_LABELS[role]}
                            </option>
                          ))}
                          {/* FYP-II role: shown if a user has it, but it can't be given here */}
                          {u.role === 'instructor' && (
                            <option value="instructor" disabled>
                              {ROLE_LABELS.instructor}
                            </option>
                          )}
                        </select>
                      </td>
                      <td>
                        <Button
                          variant="danger"
                          className={styles.deleteButton}
                          aria-label={`Delete ${u.name}`}
                          aria-describedby={isMe ? 'self-note' : undefined}
                          disabled={locked}
                          onClick={() => {
                            setDeleteError('');
                            setDeleteTarget(u);
                          }}
                        >
                          Delete
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p id="self-note" className={styles.note}>
              {SELF_NOTE}
            </p>
          </div>
        )}
      </Card>

      {data && data.total > 0 && (
        <nav className={styles.pagination} aria-label="Pagination">
          <Button variant="outline" onClick={() => setPage(page - 1)} disabled={loading || page <= 1}>
            Previous
          </Button>
          <span aria-live="polite">
            Page {data.page} of {totalPages} ({data.total} {data.total === 1 ? 'user' : 'users'})
          </span>
          <Button variant="outline" onClick={() => setPage(page + 1)} disabled={loading || page >= totalPages}>
            Next
          </Button>
        </nav>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={`Delete ${deleteTarget.name}?`}
          description={
            <p>
              This permanently deletes <strong>{deleteTarget.email}</strong> and their chat history. It cannot be undone.
            </p>
          }
          confirmLabel="Delete user"
          busyLabel="Deleting..."
          busy={deleting}
          error={deleteError}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
