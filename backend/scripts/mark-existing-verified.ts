/**
 * npm run db:mark-verified   (one-time migration)
 *
 * Accounts created before email verification existed have no `emailVerified` field.
 * Mongoose would read them as `false` (the schema default), which would lock those
 * users out with "EMAIL_NOT_VERIFIED". This marks exactly those accounts as verified.
 *
 * Safe to run more than once: it only touches users that don't have the field yet,
 * so new, genuinely unverified sign-ups are never changed.
 */
import * as path from 'path';
import { config as loadDotenv } from 'dotenv';
import mongoose from 'mongoose';
import { validateEnv } from '../src/config/env';
import { describeMongoUri } from '../src/database/database-logging';

loadDotenv({ path: path.resolve(__dirname, '../../.env') });

async function main() {
  const env = validateEnv(process.env);
  console.log(`Connecting to ${describeMongoUri(env.MONGODB_URI)} ...`);
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  const users = mongoose.connection.collection('users');

  const before = {
    total: await users.countDocuments({}),
    withoutField: await users.countDocuments({ emailVerified: { $exists: false } }),
  };
  console.log(`Users: ${before.total}, created before email verification: ${before.withoutField}`);

  const result = await users.updateMany({ emailVerified: { $exists: false } }, { $set: { emailVerified: true } });
  console.log(`Marked as verified: ${result.modifiedCount}`);

  const after = await users.aggregate<{ _id: boolean; count: number }>([
    { $group: { _id: '$emailVerified', count: { $sum: 1 } } },
  ]).toArray();
  console.log('Now:', after.map((g) => `${g._id ? 'verified' : 'not verified'}: ${g.count}`).join(', ') || 'no users');
}

main()
  .catch((err: Error) => {
    console.error(`Migration FAILED: ${err.message}`);
    if (/tlsv1 alert|ServerSelection|ENOTFOUND/i.test(err.message)) {
      console.error("Check your internet and that Atlas > Network Access allows this computer's IP address.");
    }
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
