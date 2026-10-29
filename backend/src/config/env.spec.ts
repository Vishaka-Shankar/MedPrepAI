import { validateEnv } from './env';

const valid = {
  MONGODB_URI: 'mongodb+srv://u:p@cluster0.example.mongodb.net/medprep',
  JWT_SECRET: 'x'.repeat(64),
};

describe('validateEnv', () => {
  it('accepts a valid config and fills in defaults', () => {
    const env = validateEnv(valid);
    expect(env.PORT).toBe(3000);
    expect(env.JWT_EXPIRES_IN).toBe('1d');
    expect(env.FRONTEND_ORIGIN).toBe('http://localhost:5173');
    expect(env.RAG_SERVICE_URL).toBe('http://localhost:8000');
  });

  it('accepts a RAG_SERVICE_URL without its trailing slash and rejects one without http', () => {
    expect(validateEnv({ ...valid, RAG_SERVICE_URL: 'http://127.0.0.1:8000/' }).RAG_SERVICE_URL).toBe('http://127.0.0.1:8000');
    expect(() => validateEnv({ ...valid, RAG_SERVICE_URL: 'localhost:8000' })).toThrow('RAG_SERVICE_URL must start with http');
  });

  it('rejects a missing MONGODB_URI', () => {
    expect(() => validateEnv({ JWT_SECRET: valid.JWT_SECRET })).toThrow('MONGODB_URI is required');
  });

  it('rejects a URI that is not a MongoDB URI', () => {
    expect(() => validateEnv({ ...valid, MONGODB_URI: 'http://localhost' })).toThrow(
      'MONGODB_URI must start with',
    );
  });

  it('rejects a short JWT_SECRET', () => {
    expect(() => validateEnv({ ...valid, JWT_SECRET: 'short' })).toThrow('at least 32 characters');
  });

  it('rejects a non-numeric PORT', () => {
    expect(() => validateEnv({ ...valid, PORT: 'abc' })).toThrow('PORT must be a positive integer');
  });

  it('treats SMTP as optional, with port 587 and a default sender', () => {
    const env = validateEnv(valid);
    expect(env.SMTP_HOST).toBe('');
    expect(env.SMTP_PORT).toBe(587);
    expect(env.MAIL_FROM).toBe('MedPrep AI <no-reply@medprep.local>');
  });

  it('sends from the SMTP account by default (Gmail requires it)', () => {
    const env = validateEnv({ ...valid, SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'me@gmail.com', SMTP_PASS: 'app-password' });
    expect(env.MAIL_FROM).toBe('MedPrep AI <me@gmail.com>');
  });

  it('uses a placeholder sender when the SMTP user is not an email (Mailtrap)', () => {
    const env = validateEnv({ ...valid, SMTP_HOST: 'sandbox.smtp.mailtrap.io', SMTP_USER: 'b9d5b6', SMTP_PASS: 'x' });
    expect(env.MAIL_FROM).toBe('MedPrep AI <no-reply@medprep.local>');
  });

  it('requires a user and password when SMTP_HOST is set', () => {
    expect(() => validateEnv({ ...valid, SMTP_HOST: 'smtp.gmail.com' })).toThrow('SMTP_USER and SMTP_PASS are required');
  });
});
