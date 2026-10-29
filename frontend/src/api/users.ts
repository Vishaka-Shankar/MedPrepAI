import { User } from './auth';
import { api } from './client';

/** Roles an admin can give in the users table (the backend accepts only these two). */
export const ASSIGNABLE_ROLES = ['student', 'admin'] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

/** GET /users answer: one page of users. */
export interface UserPage {
  items: User[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface UserListQuery {
  page: number;
  limit: number;
  search?: string;
}

/** One function per /users endpoint (route table in the README). Every call needs a logged-in user. */
export const usersApi = {
  // ---------- own account ----------
  me: () => api.get<User>('/users/me').then((r) => r.data),

  updateProfile: (body: { name: string }) => api.patch<User>('/users/me', body).then((r) => r.data),

  /** Ends every other session; the answer carries a fresh token for this one. */
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    api.patch<{ message: string; accessToken: string }>('/users/me/password', body).then((r) => r.data),

  /** Emails a code to the NEW address; nothing changes until confirmEmailChange. */
  requestEmailChange: (body: { newEmail: string; password: string }) =>
    api.post<{ message: string; email: string }>('/users/me/change-email', body).then((r) => r.data),

  confirmEmailChange: (body: { code: string }) =>
    api.post<{ message: string; user: User }>('/users/me/change-email/verify', body).then((r) => r.data),

  /** DELETE with a body: axios sends it as `data`. */
  deleteMe: (body: { password: string }) =>
    api.delete<{ message: string }>('/users/me', { data: body }).then((r) => r.data),

  // ---------- admin ----------
  list: ({ page, limit, search }: UserListQuery) =>
    api
      .get<UserPage>('/users', { params: { page, limit, ...(search ? { search } : {}) } })
      .then((r) => r.data),

  get: (id: string) => api.get<User>(`/users/${encodeURIComponent(id)}`).then((r) => r.data),

  setRole: (id: string, role: AssignableRole) =>
    api.patch<User>(`/users/${encodeURIComponent(id)}/role`, { role }).then((r) => r.data),

  remove: (id: string) => api.delete<{ message: string }>(`/users/${encodeURIComponent(id)}`).then((r) => r.data),
};
