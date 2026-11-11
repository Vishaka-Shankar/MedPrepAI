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

/** Two-step login, step 1: the password was right and a login code was emailed. No token yet. */
export interface LoginCodeStep {
  twoFactorRequired: true;
  email: string;
  message: string;
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

  /** A token straight away, or (two-step login, the default) a LoginCodeStep: then call verifyLogin with the emailed code. */
  login: (body: { email: string; password: string }) =>
    api.post<AuthResponse | LoginCodeStep>('/auth/login', body).then((r) => r.data),

  /** Two-step login, step 2: the emailed login code gives the token. */
  verifyLogin: (body: { email: string; code: string }) =>
    api.post<AuthResponse>('/auth/login/verify', body).then((r) => r.data),

  /** Always the same message; a code is only sent while a login is waiting for one. */
  resendLogin: (body: { email: string }) => api.post<{ message: string }>('/auth/login/resend', body).then((r) => r.data),

  me: () => api.get<User>('/auth/me').then((r) => r.data),

  /** Always the same message, so it never reveals whether the email is registered. */
  forgotPassword: (body: { email: string }) =>
    api.post<{ message: string }>('/auth/forgot-password', body).then((r) => r.data),

  resetPassword: (body: { email: string; code: string; newPassword: string }) =>
    api.post<{ message: string }>('/auth/reset-password', body).then((r) => r.data),
};
