/**
 * Reads and checks environment variables once at startup.
 * If something is missing the app refuses to start with a clear message,
 * instead of failing later with a confusing error.
 */
export interface AppEnv {
  MONGODB_URI: string;
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
  PORT: number;
  FRONTEND_ORIGIN: string;
  // The Python Q&A service (rag-service/app), called by POST /chat/ask
  RAG_SERVICE_URL: string;
  // Email (OTP codes). Optional: without SMTP_HOST the app starts, but sending fails with a clear 503.
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_USER: string;
  SMTP_PASS: string;
  MAIL_FROM: string;
  // Two-step login: after the right password, a 6-digit code is emailed. true unless set to false.
  LOGIN_2FA: boolean;
}

export function validateEnv(raw: Record<string, unknown>): AppEnv {
  const errors: string[] = [];
  const str = (key: string, fallback?: string): string => {
    const value = raw[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
    if (fallback !== undefined) return fallback;
    errors.push(`${key} is required`);
    return '';
  };

  const login2fa = str('LOGIN_2FA', 'true').toLowerCase();
  const env: AppEnv = {
    MONGODB_URI: str('MONGODB_URI'),
    JWT_SECRET: str('JWT_SECRET'),
    JWT_EXPIRES_IN: str('JWT_EXPIRES_IN', '1d'),
    PORT: Number(str('PORT', '3000')),
    FRONTEND_ORIGIN: str('FRONTEND_ORIGIN', 'http://localhost:5173'),
    RAG_SERVICE_URL: str('RAG_SERVICE_URL', 'http://localhost:8000').replace(/\/+$/, ''),
    SMTP_HOST: str('SMTP_HOST', ''),
    SMTP_PORT: Number(str('SMTP_PORT', '587')),
    SMTP_USER: str('SMTP_USER', ''),
    SMTP_PASS: str('SMTP_PASS', ''),
    MAIL_FROM: '',
    LOGIN_2FA: login2fa !== 'false',
  };
  // Gmail only accepts mail "from" the account itself, so default to the SMTP user when it is an
  // address. Mailtrap-style usernames are not addresses, so those get a placeholder sender.
  const userIsAddress = env.SMTP_USER.includes('@');
  env.MAIL_FROM = str('MAIL_FROM', userIsAddress ? `MedPrep AI <${env.SMTP_USER}>` : 'MedPrep AI <no-reply@medprep.local>');

  if (env.MONGODB_URI && !/^mongodb(\+srv)?:\/\//.test(env.MONGODB_URI)) {
    errors.push('MONGODB_URI must start with mongodb:// or mongodb+srv://');
  }
  if (env.JWT_SECRET && env.JWT_SECRET.length < 32) {
    errors.push('JWT_SECRET must be at least 32 characters');
  }
  if (!/^https?:\/\//.test(env.RAG_SERVICE_URL)) {
    errors.push('RAG_SERVICE_URL must start with http:// or https://');
  }
  if (!Number.isInteger(env.PORT) || env.PORT <= 0) {
    errors.push('PORT must be a positive integer');
  }
  if (!Number.isInteger(env.SMTP_PORT) || env.SMTP_PORT <= 0) {
    errors.push('SMTP_PORT must be a positive integer (587 for STARTTLS, 465 for SSL)');
  }
  if (env.SMTP_HOST && (!env.SMTP_USER || !env.SMTP_PASS)) {
    errors.push('SMTP_USER and SMTP_PASS are required when SMTP_HOST is set');
  }

  if (login2fa !== 'true' && login2fa !== 'false') {
    errors.push('LOGIN_2FA must be true or false');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n - ${errors.join('\n - ')}`);
  }
  return env;
}
