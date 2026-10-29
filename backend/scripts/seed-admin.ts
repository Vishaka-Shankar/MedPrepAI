/**
 * npm run db:seed-admin
 *
 * Creates the first admin from ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD in the root .env
 * (email already verified), or promotes an existing account with that email.
 * Safe to run more than once. Prints the masked email only, never the password.
 */
import 'reflect-metadata';
import * as path from 'path';
import { config as loadDotenv } from 'dotenv';
import mongoose from 'mongoose';
import { maskEmail } from '../src/auth/mask-email';
import { validateEnv } from '../src/config/env';
import { describeMongoUri } from '../src/database/database-logging';
import { User, UserSchema } from '../src/schemas/user.schema';
import { readAdminEnv, seedAdmin } from '../src/users/seed-admin';

loadDotenv({ path: path.resolve(__dirname, '../../.env') });

const MESSAGES = {
  created: 'Admin account created (email already verified). Log in with ADMIN_EMAIL and ADMIN_PASSWORD.',
  promoted: 'An account with this email already existed: it is now an admin. Its password was NOT changed.',
  'already-admin': 'This account is already an admin. Nothing changed.',
} as const;

async function main() {
  const env = validateEnv(process.env);
  const admin = readAdminEnv(process.env); // checked before connecting
  console.log(`Connecting to ${describeMongoUri(env.MONGODB_URI)} ...`);
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });

  const result = await seedAdmin(mongoose.model(User.name, UserSchema), admin);
  console.log(`${maskEmail(admin.email)}: ${MESSAGES[result]}`);
}

main()
  .catch((err: Error) => {
    console.error(`Admin seed FAILED: ${err.message}`);
    if (/tlsv1 alert|ServerSelection|ENOTFOUND/i.test(err.message)) {
      console.error("Check your internet and that Atlas > Network Access allows this computer's IP address.");
    }
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
