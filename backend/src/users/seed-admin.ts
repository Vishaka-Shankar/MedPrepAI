import * as bcrypt from 'bcrypt';
import { Model } from 'mongoose';
import { BCRYPT_ROUNDS } from '../auth/auth.service';
import { PASSWORD_MAX, PASSWORD_MIN, PASSWORD_PATTERN } from '../auth/dto/validators';
import { User } from '../schemas/user.schema';

export interface AdminInput {
  name: string;
  email: string;
  password: string;
}

export type SeedResult = 'created' | 'promoted' | 'already-admin';

/** Reads ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD and checks them with the same rules as registration. */
export function readAdminEnv(env: Record<string, string | undefined>): AdminInput {
  const name = env.ADMIN_NAME?.trim() ?? '';
  const email = env.ADMIN_EMAIL?.trim().toLowerCase() ?? '';
  const password = env.ADMIN_PASSWORD ?? '';

  const errors: string[] = [];
  if (name.length < 2 || name.length > 80) errors.push('ADMIN_NAME must be 2 to 80 characters');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('ADMIN_EMAIL must be a valid email address');
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX || !PASSWORD_PATTERN.test(password)) {
    errors.push(`ADMIN_PASSWORD must be ${PASSWORD_MIN} to ${PASSWORD_MAX} characters with a letter and a number`);
  }
  if (errors.length > 0) throw new Error(`Set these in the root .env:\n - ${errors.join('\n - ')}`);
  return { name, email, password };
}

/**
 * Creates the admin (email already verified), or makes an existing account with that email an admin.
 * An existing account keeps its own password: the seed never overwrites a password silently.
 * Safe to run more than once.
 */
export async function seedAdmin(userModel: Model<User>, input: AdminInput): Promise<SeedResult> {
  const existing = await userModel.findOne({ email: input.email }).exec();
  if (existing) {
    if (existing.role === 'admin' && existing.emailVerified) return 'already-admin';
    await userModel.updateOne({ _id: existing._id }, { $set: { role: 'admin', emailVerified: true } }).exec();
    return 'promoted';
  }
  await userModel.create({
    name: input.name,
    email: input.email,
    passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS),
    role: 'admin',
    emailVerified: true,
  });
  return 'created';
}
