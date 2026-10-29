import { useCallback, useEffect, useState } from 'react';

/**
 * Counts down whole seconds, e.g. for "Resend code (42s)".
 * Returns the seconds left and a function to start again from `seconds`.
 * It stores the end time (not a counter), so a slow or paused tab still shows the right number.
 */
export function useCountdown(seconds: number): [number, () => void] {
  const [endsAt, setEndsAt] = useState(() => Date.now() + seconds * 1000);
  const [now, setNow] = useState(() => Date.now());

  const remaining = Math.max(0, Math.ceil((endsAt - now) / 1000));
  const running = remaining > 0;

  // Tick once a second while counting; no timer at all once it reaches 0
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  const restart = useCallback(() => {
    const t = Date.now();
    setNow(t);
    setEndsAt(t + seconds * 1000);
  }, [seconds]);

  return [remaining, restart];
}
