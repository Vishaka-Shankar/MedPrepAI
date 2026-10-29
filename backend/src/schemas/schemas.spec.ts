import { SchemaType } from 'mongoose';
import { ALL_MODELS } from './index';
import { UserSchema } from './user.schema';
import { OtpCodeSchema } from './otp-code.schema';
import { TopicMasterySchema } from './topic-mastery.schema';

describe('ERD schemas', () => {
  it('registers the 17 ERD collections plus otp_codes', () => {
    expect(ALL_MODELS).toHaveLength(18);
  });

  it('lets MongoDB delete expired OTP codes (TTL index on expiresAt)', () => {
    expect(OtpCodeSchema.indexes()).toContainEqual([{ expiresAt: 1 }, expect.objectContaining({ expireAfterSeconds: 0 })]);
  });

  it('creates users as not verified by default', () => {
    expect(UserSchema.path('emailVerified').options.default).toBe(false);
  });

  // Enum fields typed as a union ('a' | 'b') need an explicit `type: String`,
  // otherwise the schema fails to build when files are compiled one at a time
  // (the dev server and Jest both do that).
  it('builds every schema and stores enum fields as strings', () => {
    for (const { name, schema } of ALL_MODELS) {
      schema.eachPath((path: string, type: SchemaType) => {
        if ((type.options as { enum?: unknown }).enum) {
          expect({ model: name, path, instance: type.instance }).toEqual({ model: name, path, instance: 'String' });
        }
      });
    }
  });

  it('never returns the password hash by default', () => {
    expect(UserSchema.path('passwordHash').options.select).toBe(false);
  });

  it('starts topic mastery at 0.5 (proposal 5.1)', () => {
    expect(TopicMasterySchema.path('mastery').options.default).toBe(0.5);
  });
});
