import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, it } from 'vitest';
import { getErrorCode, getErrorEmail, getErrorMessage, SERVER_SLOW, SERVER_TROUBLE, TOO_MANY_REQUESTS } from './client';

function httpError(status: number, data: unknown) {
  const headers = new AxiosHeaders();
  return new AxiosError('Request failed', String(status), { headers }, null, {
    status,
    statusText: 'Error',
    data,
    headers: {},
    config: { headers },
  });
}

describe('getErrorMessage', () => {
  it('shows the server message for normal errors, joining validation lists', () => {
    expect(getErrorMessage(httpError(401, { message: 'Invalid email or password' }))).toBe('Invalid email or password');
    expect(getErrorMessage(httpError(400, { message: ['email must be valid', 'code must be 6 digits'] }))).toBe(
      'email must be valid. code must be 6 digits',
    );
  });

  it('turns 429 into a friendly sentence', () => {
    expect(getErrorMessage(httpError(429, { message: 'ThrottlerException: Too Many Requests' }))).toBe(TOO_MANY_REQUESTS);
  });

  it("keeps a 503's own sentence (database or email down), but hides a bare 500", () => {
    const db = 'The database is not reachable right now. Please try again in a minute.';
    expect(getErrorMessage(httpError(503, { message: db }))).toBe(db);
    expect(getErrorMessage(httpError(503, {}))).toBe(SERVER_TROUBLE);
    expect(getErrorMessage(httpError(500, { message: 'Internal server error' }))).toBe(SERVER_TROUBLE);
  });

  it('explains a timeout and an unreachable server', () => {
    expect(getErrorMessage(new AxiosError('timeout', 'ECONNABORTED'))).toBe(SERVER_SLOW);
    expect(getErrorMessage(new AxiosError('Network Error', 'ERR_NETWORK'))).toMatch(/Cannot reach the server/);
  });
});

describe('getErrorCode / getErrorEmail', () => {
  it('read the extra fields of our auth errors, or null', () => {
    const err = httpError(403, { code: 'EMAIL_NOT_VERIFIED', message: 'Verify first', email: 'a@b.com' });
    expect(getErrorCode(err)).toBe('EMAIL_NOT_VERIFIED');
    expect(getErrorEmail(err)).toBe('a@b.com');
    expect(getErrorCode(new Error('boom'))).toBeNull();
    expect(getErrorEmail(httpError(500, ''))).toBeNull();
  });
});
