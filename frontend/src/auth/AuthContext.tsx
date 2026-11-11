import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { AuthResponse, authApi, LoginCodeStep, RegisterResponse, User } from '../api/auth';
import { tokenStorage } from '../api/client';

interface AuthState {
  user: User | null;
  /** True while we check a saved token on page load. */
  loading: boolean;
  /** A message for the login page, e.g. "Your session has expired". */
  notice: string;
  /**
   * Checks the password. Returns null when the user is now logged in, or a LoginCodeStep when a
   * login code was emailed (two-step login): then verifyLogin with that code finishes the login.
   */
  login: (email: string, password: string) => Promise<LoginCodeStep | null>;
  /** Two-step login, step 2: checks the emailed login code; on success the user is logged in. */
  verifyLogin: (email: string, code: string) => Promise<void>;
  /** Asks for a new login code; returns the server's message (always the same). */
  resendLogin: (email: string) => Promise<string>;
  /** Creates the account and emails a code; the user is NOT logged in until the code is verified. */
  register: (name: string, email: string, password: string) => Promise<RegisterResponse>;
  /** Checks the emailed code; on success the user is logged in. */
  verifyOtp: (email: string, code: string) => Promise<void>;
  /** Asks for a new code; returns the server's message (the same whether or not one was sent). */
  resendOtp: (email: string) => Promise<string>;
  /** Log out; pass a notice to explain why (shown on the login page). */
  logout: (notice?: string) => void;
  /** Keep the session in step after a profile change: a new name/email, or the fresh token a password change returns. */
  updateSession: (update: { user?: User; accessToken?: string }) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');

  // On page load: if a token was saved, ask the backend who it belongs to.
  // If the token is expired or invalid, forget it.
  useEffect(() => {
    if (!tokenStorage.get()) {
      setLoading(false);
      return;
    }
    authApi
      .me()
      .then(setUser)
      .catch(() => tokenStorage.clear())
      .finally(() => setLoading(false));
  }, []);

  const saveSession = (res: AuthResponse) => {
    tokenStorage.set(res.accessToken);
    setNotice('');
    setUser(res.user);
  };

  const login = useCallback(async (email: string, password: string) => {
    const res = await authApi.login({ email, password });
    if ('twoFactorRequired' in res) return res; // no token yet: the code screen comes next
    saveSession(res);
    return null;
  }, []);

  const verifyLogin = useCallback(async (email: string, code: string) => {
    saveSession(await authApi.verifyLogin({ email, code }));
  }, []);

  const resendLogin = useCallback(async (email: string) => (await authApi.resendLogin({ email })).message, []);

  const register = useCallback(
    (name: string, email: string, password: string) => authApi.register({ name, email, password }),
    [],
  );

  const verifyOtp = useCallback(async (email: string, code: string) => {
    saveSession(await authApi.verifyOtp({ email, code }));
  }, []);

  const resendOtp = useCallback(async (email: string) => (await authApi.resendOtp({ email })).message, []);

  const logout = useCallback((reason?: string) => {
    tokenStorage.clear();
    setNotice(reason ?? '');
    setUser(null);
  }, []);

  const updateSession = useCallback((update: { user?: User; accessToken?: string }) => {
    if (update.accessToken) tokenStorage.set(update.accessToken);
    if (update.user) setUser(update.user);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, notice, login, verifyLogin, resendLogin, register, verifyOtp, resendOtp, logout, updateSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
