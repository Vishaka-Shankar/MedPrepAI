import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, getTestMessageUrl, SendMailOptions, SentMessageInfo, Transporter } from 'nodemailer';
import { maskEmail } from '../auth/mask-email';
import { AppEnv } from '../config/env';
import { OtpPurpose } from '../schemas/otp-code.schema';
import { renderOtpEmail } from './otp-email';

export const EMAIL_SEND_FAILED = "Couldn't send the email, try again";

/** Milliseconds nodemailer may wait at each stage before giving up (connect, server greeting, idle socket). */
export const SMTP_TIMEOUTS = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000 } as const;

/** True when running under Jest: no real emails, and tests may read the codes. */
export const isTestMode = (): boolean => process.env.NODE_ENV === 'test';

/** A message the test-mode transport "sent". */
export interface SentMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Sends emails through SMTP (nodemailer).
 * In test mode it uses nodemailer's JSON transport (nothing leaves the computer) and
 * keeps every message in `outbox`, so tests can read the code like a user would.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;
  private readonly from: string;
  private readonly smtpHost: string;
  readonly outbox: SentMail[] = [];

  constructor(config: ConfigService<AppEnv, true>) {
    this.from = config.get('MAIL_FROM', { infer: true });
    this.smtpHost = config.get('SMTP_HOST', { infer: true });
    const port = config.get('SMTP_PORT', { infer: true });
    this.transporter = isTestMode()
      ? createTransport({ jsonTransport: true })
      : createTransport({
          host: this.smtpHost,
          port,
          secure: port === 465, // 465 = SSL from the start; 587 = STARTTLS
          auth: { user: config.get('SMTP_USER', { infer: true }), pass: config.get('SMTP_PASS', { infer: true }) },
          // nodemailer waits up to 2-10 minutes by default; fail fast so the user gets the 503 quickly
          ...SMTP_TIMEOUTS,
        });
  }

  /** One startup line saying how mail is sent (never the password). */
  onModuleInit(): void {
    if (isTestMode()) this.logger.log('Mail: test mode, emails are kept in memory and never sent');
    else if (!this.smtpHost) this.logger.warn('Mail: SMTP_HOST is not set, so verification emails cannot be sent (see README)');
    else this.logger.log(`Mail: sending through ${this.smtpHost} as ${this.from.replace(/<(.+)>/, (_, a: string) => `<${maskEmail(a)}>`)}`);
  }

  /** Email a one-time code. Throws 503 with a friendly message if it can't be sent. */
  async sendOtp(to: string, code: string, purpose: OtpPurpose, validMinutes: number): Promise<void> {
    const content = renderOtpEmail(code, purpose, validMinutes);
    let info: SentMessageInfo;
    try {
      info = await this.deliver({ from: this.from, to, ...content });
    } catch (err) {
      // Log the reason (never the code), but don't crash: the user can try again
      this.logger.error(`Could not send ${purpose} email to ${maskEmail(to)}: ${(err as Error).message}`);
      throw new ServiceUnavailableException({ statusCode: 503, code: 'EMAIL_SEND_FAILED', message: EMAIL_SEND_FAILED });
    }
    if (isTestMode()) this.outbox.push({ to, ...content });
    this.logger.log(`Sent ${purpose} email to ${maskEmail(to)}`);

    // Ethereal (development) never delivers mail; it gives a web link to read the message instead.
    // getTestMessageUrl returns false for every other server, so real SMTP never logs a link.
    const previewUrl = getTestMessageUrl(info);
    if (previewUrl) this.logger.log(`Ethereal preview (dev only): ${previewUrl}`);
  }

  /** The actual send (a separate method so tests can make it fail). */
  protected async deliver(message: SendMailOptions): Promise<SentMessageInfo> {
    if (!isTestMode() && !this.smtpHost) throw new Error('SMTP_HOST is not set in .env');
    return this.transporter.sendMail(message);
  }
}
