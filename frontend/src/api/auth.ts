import { api } from './client';

/** "admin" manages users (/admin/users); "instructor" is for FYP-II cohorts. */
export type UserRole = 'student' | 'instructor' | 'admin';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  emailVerified?: boolean;
}

export interface AuthResponse {
  accessToken: string;
  user: User;
}

/** Register gives no token: the user must first enter the 6-digit code we emailed. */
export interface RegisterResponse {
  message: string;
  email: string;
}

export const authApi = {
  register: (body: { name: string; email: string; password: string }) =>
    api.post<RegisterResponse>('/auth/register', body).then((r) => r.data),

  verifyOtp: (body: { email: string; code: string }) =>
    api.post<AuthResponse>('/auth/verify-otp', body).then((r) => r.data),

  /** Always answers with the same message (the server never says whether the email exists). */
  resendOtp: (body: { email: string }) => api.post<{ message: string }>('/auth/resend-otp', body).then((r) => r.data),

  login: (body: { email: string; password: string }) =>
    api.post<AuthResponse>('/auth/login', body).then((r) => r.data),

  me: () => api.get<User>('/auth/me').then((r) => r.data),

  /** Always the same message, so it never reveals whether the email is registered. */
  forgotPassword: (body: { email: string }) =>
    api.post<{ message: string }>('/auth/forgot-password', body).then((r) => r.data),

  resetPassword: (body: { email: string; code: string; newPassword: string }) =>
    api.post<{ message: string }>('/auth/reset-password', body).then((r) => r.data),
};
