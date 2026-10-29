import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SendMailOptions, SentMessageInfo } from 'nodemailer';
import { AppEnv } from '../config/env';
import { MailService, SMTP_TIMEOUTS } from './mail.service';

/** MailService whose send answers like a given SMTP server, so we can check what gets logged. */
class ServerReplyMailService extends MailService {
  constructor(private readonly serverReply: string) {
    super({ get: () => '' } as unknown as ConfigService<AppEnv, true>);
  }
  protected override async deliver(_message: SendMailOptions): Promise<SentMessageInfo> {
    return { response: this.serverReply } as SentMessageInfo;
  }
}

describe('MailService Ethereal preview link', () => {
  let logged: string[];
  beforeEach(() => {
    logged = [];
    jest.spyOn(Logger.prototype, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(String(args[0]));
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it('logs the preview link (and never the code) when Ethereal accepts the email', async () => {
    const mail = new ServerReplyMailService('250 Accepted [STATUS=new MSGID=abc123]');
    await mail.sendOtp('student@example.com', '654321', 'verify_email', 10);

    expect(logged).toContain('Ethereal preview (dev only): https://ethereal.email/message/abc123');
    expect(logged.join('\n')).not.toContain('654321');
  });

  it('logs no link for a real mail server such as Gmail', async () => {
    const mail = new ServerReplyMailService('250 2.0.0 OK 1730000000 gsmtp');
    await mail.sendOtp('student@example.com', '654321', 'verify_email', 10);

    expect(logged.some((line) => line.includes('preview'))).toBe(false);
  });
});

describe('MailService SMTP transport', () => {
  const realNodeEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = realNodeEnv;
  });

  it('gives up quickly on a slow or blocked SMTP server instead of waiting minutes', () => {
    process.env.NODE_ENV = 'development'; // build the real SMTP transport, not the test one
    const values: Partial<AppEnv> = {
      MAIL_FROM: 'MedPrep AI <no-reply@medprep.local>',
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: 587,
      SMTP_USER: 'user',
      SMTP_PASS: 'pass',
    };
    const config = { get: (key: keyof AppEnv) => values[key] } as unknown as ConfigService<AppEnv, true>;

    const service = new MailService(config);
    // The transporter is private; read its options only to check the timeouts are passed through
    const options = (service as unknown as { transporter: { options: Record<string, unknown> } }).transporter.options;

    expect(options).toMatchObject({ host: 'smtp.example.com', port: 587, secure: false, ...SMTP_TIMEOUTS });
    expect(SMTP_TIMEOUTS.connectionTimeout).toBeLessThanOrEqual(10_000);
  });
});
