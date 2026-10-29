import { useCallback, useEffect, useState } from 'react';
import { getErrorMessage } from '../api/client';

export interface AsyncData<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Runs `load` when the component appears and keeps track of loading / error / data.
 * `load` must be a stable function (defined outside the component).
 */
export function useAsyncData<T>(load: () => Promise<T>): AsyncData<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true; // ignore a result that arrives after the page was left
    setLoading(true);
    setError(null);
    load()
      .then((result) => current && setData(result))
      .catch((err: unknown) => current && setError(getErrorMessage(err)))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [load, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { data, loading, error, reload };
}
