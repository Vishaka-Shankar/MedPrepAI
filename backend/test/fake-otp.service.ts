import { OtpCheck } from '../src/auth/otp.service';

/**
 * Test double for OtpService (no database): every issued code is "123456" and is remembered
 * per user, so unit and HTTP tests can check the auth flow quickly. The real OtpService
 * (hashing, expiry, attempts, cooldown) is tested against MongoDB in auth.db.e2e.spec.ts.
 */
export class FakeOtpService {
  static readonly CODE = '123456';
  issued: { userId: string; email: string; purpose: string }[] = [];
  private active = new Map<string, string>(); // "userId:purpose" -> address the code went to

  async secondsUntilResend(): Promise<number> {
    return 0;
  }

  async issue(user: { id: string; email: string }, purpose: string): Promise<string> {
    this.issued.push({ userId: user.id, email: user.email, purpose });
    this.active.set(`${user.id}:${purpose}`, user.email);
    return FakeOtpService.CODE;
  }

  async discardAll(userId: string): Promise<void> {
    for (const key of [...this.active.keys()]) if (key.startsWith(`${userId}:`)) this.active.delete(key);
  }

  async discard(userId: string, purpose: string): Promise<void> {
    this.active.delete(`${userId}:${purpose}`);
  }

  async verify(userId: string, purpose: string, code: string): Promise<OtpCheck> {
    const key = `${userId}:${purpose}`;
    const email = this.active.get(key);
    if (email === undefined) return { status: 'invalid' };
    if (code !== FakeOtpService.CODE) return { status: 'wrong', attemptsLeft: 4 };
    this.active.delete(key);
    return { status: 'ok', email };
  }
}
