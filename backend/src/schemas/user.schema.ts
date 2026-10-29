import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

// student: everyone who registers. admin: manages users (seeded by `npm run db:seed-admin`).
// instructor: from the ERD, used by cohorts in FYP-II.
export const USER_ROLES = ['student', 'instructor', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export type UserDocument = HydratedDocument<User>;

// ERD: USER (_id, name, email UK, passwordHash, role)
@Schema({ collection: 'users', timestamps: true })
export class User {
  @Prop({ required: true, trim: true, maxlength: 80 })
  name!: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email!: string;

  // select: false -> the hash is never returned unless a query asks for it explicitly
  @Prop({ required: true, select: false })
  passwordHash!: string;

  @Prop({ type: String, required: true, enum: USER_ROLES, default: 'student' })
  role!: UserRole;

  // Set to true after the user enters the code we emailed (POST /auth/verify-otp).
  // Accounts created before this feature were marked true by scripts/mark-existing-verified.ts
  @Prop({ type: Boolean, required: true, default: false })
  emailVerified!: boolean;

  // Copied into every JWT as "tv". Changing or resetting the password adds 1, so every token
  // issued before that no longer matches and is refused (JwtStrategy): old sessions are logged out.
  @Prop({ type: Number, required: true, default: 0, min: 0 })
  tokenVersion!: number;
}

export const UserSchema = SchemaFactory.createForClass(User);
