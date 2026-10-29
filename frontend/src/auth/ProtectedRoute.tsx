import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { UserRole } from '../api/auth';
import { useAuth } from './AuthContext';

/** Wraps pages that need login. Not logged in -> go to /login (and come back after). */
export function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <p className="page-loading">Loading...</p>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

/**
 * Wraps pages for one role (inside ProtectedRoute, so the user is known), e.g. /admin/users.
 * Anyone else is sent to the chat, the same as an unknown address. This only hides the page:
 * the backend refuses the API calls with 403 for non-admins anyway.
 */
export function RequireRole({ role }: { role: UserRole }) {
  const { user } = useAuth();
  if (user?.role !== role) return <Navigate to="/chat" replace />;
  return <Outlet />;
}

/**
 * Wraps /login, /register, /verify-otp and /forgot-password. As soon as a user is logged in (including right
 * after submitting the form) send them into the app: back to the page they
 * originally asked for, or the chat.
 */
export function GuestOnlyRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <p className="page-loading">Loading...</p>;
  if (user) {
    const from = (location.state as { from?: string } | null)?.from ?? '/chat';
    return <Navigate to={from} replace />;
  }
  return <Outlet />;
}
