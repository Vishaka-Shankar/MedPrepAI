import { useCallback } from 'react';
import { getErrorMessage, httpStatus } from '../api/client';
import { useAuth } from '../auth/AuthContext';

export const SESSION_EXPIRED = 'Your session has expired. Please log in again.';

/**
 * For pages behind login: turns an API error into a sentence for the UI.
 * A 401 means the session is over (token expired, or the password was changed on another
 * device), so it also logs out; the route guard then opens the login page with the reason.
 * (A wrong password typed into a form is a 403 from our backend, so it never logs anyone out.)
 */
export function useApiError(): (err: unknown) => string {
  const { logout } = useAuth();
  return useCallback(
    (err: unknown) => {
      const message = getErrorMessage(err);
      if (httpStatus(err) === 401) logout(message === 'Unauthorized' ? SESSION_EXPIRED : message);
      return message;
    },
    [logout],
  );
}
