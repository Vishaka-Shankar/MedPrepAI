import { AxiosError, AxiosHeaders } from 'axios';

/** Builds the same error axios throws when NestJS answers with an error status. */
export function httpError(status: number, data: Record<string, unknown> = {}) {
  const headers = new AxiosHeaders();
  return new AxiosError('Request failed', String(status), { headers }, null, {
    status,
    statusText: 'Error',
    data,
    headers: {},
    config: { headers },
  });
}

export const DB_DOWN = 'The database is not reachable right now. Please try again in a minute.';
