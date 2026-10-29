import axios from 'axios';

const TOKEN_KEY = 'medprep_token';

export const tokenStorage = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

/** One axios instance for the whole app, pointed at the NestJS backend. */
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:3000',
  timeout: 15000,
});

// Attach the JWT (if we have one) to every request
api.interceptors.request.use((config) => {
  const token = tokenStorage.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/** The HTTP status of a failed request, or null if the server could not be reached at all. */
export function httpStatus(err: unknown): number | null {
  return axios.isAxiosError(err) ? (err.response?.status ?? null) : null;
}

/** True when the request was cancelled because it took longer than its timeout. */
export function isTimeout(err: unknown): boolean {
  return axios.isAxiosError(err) && (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT');
}

/** The body NestJS sends with an error; our auth errors add a machine-readable `code`. */
interface ErrorBody {
  message?: string | string[];
  code?: string;
  email?: string;
}

function errorBody(err: unknown): ErrorBody {
  return (axios.isAxiosError(err) ? (err.response?.data as ErrorBody | undefined) : undefined) ?? {};
}

/** The backend's error code, e.g. "OTP_WRONG" or "EMAIL_NOT_VERIFIED", or null if there is none. */
export function getErrorCode(err: unknown): string | null {
  return errorBody(err).code ?? null;
}

/** The email the backend put in its error (403 EMAIL_NOT_VERIFIED includes it), or null. */
export function getErrorEmail(err: unknown): string | null {
  return errorBody(err).email ?? null;
}

export const TOO_MANY_REQUESTS = 'Too many attempts. Please wait a minute and try again.';
export const SERVER_SLOW = 'The server took too long to answer. Please check your connection and try again.';
export const SERVER_TROUBLE = 'The server is having trouble right now. Please try again in a minute.';

/**
 * Turns any API error into one readable sentence for the UI.
 * NestJS sends { message: string | string[] } on errors. Our 503s already carry a friendly sentence
 * (e.g. "The database is not reachable right now. Please try again in a minute."), so those are shown as-is.
 */
export function getErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    if (isTimeout(err)) return SERVER_SLOW;
    if (!err.response) return 'Cannot reach the server. Is the backend running?';
    // The throttler's own text ("ThrottlerException: Too Many Requests") is not meant for users
    const status = err.response.status;
    if (status === 429) return TOO_MANY_REQUESTS;
    // A 500's "Internal server error" says nothing useful; only 503s carry a sentence written for users
    if (status >= 500 && status !== 503) return SERVER_TROUBLE;
    const { message } = errorBody(err);
    if (Array.isArray(message)) return message.join('. ');
    if (typeof message === 'string') return message;
    if (status === 503) return SERVER_TROUBLE;
  }
  return 'Something went wrong. Please try again.';
}
