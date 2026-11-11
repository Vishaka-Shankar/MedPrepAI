import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export const OTP_PURPOSES = ['verify_email', 'reset_password', 'change_email', 'login'] as const;
export type OtpPurpose = (typeof OTP_PURPOSES)[number];

export type OtpCodeDocument = HydratedDocument<OtpCode>;

/**
 * One-time codes sent by email (not in the ERD: supports auth).
 * The code itself is never stored, only its bcrypt hash.
 */
@Schema({ collection: 'otp_codes', timestamps: { createdAt: true, updatedAt: false } })
export class OtpCode {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  // The address the code was sent to (for change_email this differs from the user's current email)
  @Prop({ required: true, lowercase: true, trim: true })
  email!: string;

  @Prop({ type: String, required: true, enum: OTP_PURPOSES })
  purpose!: OtpPurpose;

  @Prop({ required: true })
  codeHash!: string;

  // 10 minutes after creation; the TTL index below makes MongoDB delete the document after this
  @Prop({ required: true })
  expiresAt!: Date;

  // Wrong guesses so far; the code is locked at 5
  @Prop({ required: true, default: 0, min: 0 })
  attempts!: number;

  // Set once the code is used successfully; a used code never works again
  @Prop({ type: Date, default: null })
  usedAt!: Date | null;

  createdAt!: Date;
}

export const OtpCodeSchema = SchemaFactory.createForClass(OtpCode);
// TTL index: MongoDB removes a code automatically once expiresAt has passed (checked about once a minute)
OtpCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// Finding the newest code of a user for a purpose
OtpCodeSchema.index({ userId: 1, purpose: 1, createdAt: -1 });
