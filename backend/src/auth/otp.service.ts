import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { Model, Types } from 'mongoose';
import { OtpCode, OtpPurpose } from '../schemas/otp-code.schema';

export const OTP_VALID_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
const OTP_HASH_ROUNDS = 10;

export type OtpCheck =
  | { status: 'ok'; email: string } // email = the address the code was sent to (the NEW one for change_email)
  | { status: 'invalid' } // no active code (never sent, already used, or replaced by a newer one)
  | { status: 'expired' }
  | { status: 'locked' } // 5 wrong attempts
  | { status: 'wrong'; attemptsLeft: number };

/**
 * Creates and checks 6-digit one-time codes. Only a bcrypt hash of each code is stored.
 * Why bcrypt: even with a copy of the database, guessing one code takes hours, and it expires in 10 minutes.
 */
@Injectable()
export class OtpService {
  constructor(@InjectModel(OtpCode.name) private readonly otpModel: Model<OtpCode>) {}

  /** A random 6-digit code, "000000" to "999999" (crypto.randomInt is cryptographically secure). */
  generateCode(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  /** Seconds before another code may be sent for this user and purpose (0 = now). */
  async secondsUntilResend(userId: string, purpose: OtpPurpose): Promise<number> {
    const last = await this.otpModel.findOne({ userId: new Types.ObjectId(userId), purpose }).sort({ createdAt: -1 }).exec();
    if (!last) return 0;
    const elapsed = (Date.now() - last.createdAt.getTime()) / 1000;
    return Math.max(0, Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - elapsed));
  }

  /** Make a new code. Older unused codes for the same purpose are deleted, so only the newest works. */
  async issue(user: { id: string; email: string }, purpose: OtpPurpose): Promise<string> {
    const userId = new Types.ObjectId(user.id);
    await this.otpModel.deleteMany({ userId, purpose, usedAt: null }).exec();
    const code = this.generateCode();
    await this.otpModel.create({
      userId,
      email: user.email,
      purpose,
      codeHash: await bcrypt.hash(code, OTP_HASH_ROUNDS),
      expiresAt: new Date(Date.now() + OTP_VALID_MINUTES * 60_000),
      attempts: 0,
      usedAt: null,
    });
    return code;
  }

  /** Remove every code of a user (registration rolled back, password reset, account deleted). */
  async discardAll(userId: string): Promise<void> {
    await this.otpModel.deleteMany({ userId: new Types.ObjectId(userId) }).exec();
  }

  /** Remove a user's codes for one purpose (e.g. its email could not be sent, so the code is useless). */
  async discard(userId: string, purpose: OtpPurpose): Promise<void> {
    await this.otpModel.deleteMany({ userId: new Types.ObjectId(userId), purpose }).exec();
  }

  /** Check a code: expiry first, then the attempt limit, then the hash. A correct code is used up. */
  async verify(userId: string, purpose: OtpPurpose, code: string): Promise<OtpCheck> {
    const otp = await this.otpModel
      .findOne({ userId: new Types.ObjectId(userId), purpose, usedAt: null })
      .sort({ createdAt: -1 })
      .exec();
    if (!otp) return { status: 'invalid' };
    if (otp.expiresAt.getTime() <= Date.now()) return { status: 'expired' };
    if (otp.attempts >= OTP_MAX_ATTEMPTS) return { status: 'locked' };

    if (!(await bcrypt.compare(code, otp.codeHash))) {
      // $inc is atomic, so two wrong guesses at the same moment both count
      const updated = await this.otpModel.findByIdAndUpdate(otp._id, { $inc: { attempts: 1 } }, { new: true }).exec();
      const attemptsLeft = OTP_MAX_ATTEMPTS - (updated?.attempts ?? OTP_MAX_ATTEMPTS);
      return attemptsLeft > 0 ? { status: 'wrong', attemptsLeft } : { status: 'locked' };
    }

    // Mark used only if still unused, so the same code can't be used twice at the same moment
    const used = await this.otpModel.findOneAndUpdate({ _id: otp._id, usedAt: null }, { $set: { usedAt: new Date() } }).exec();
    return used ? { status: 'ok', email: otp.email } : { status: 'invalid' };
  }
}
