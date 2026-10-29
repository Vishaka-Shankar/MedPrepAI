import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, Length, Matches, MaxLength } from 'class-validator';

/**
 * Validation rules shared by every auth and account DTO, so "a valid password" or "a valid
 * email" means the same thing everywhere. `$property` is replaced by the field name.
 */

// bcrypt only uses the first 72 bytes, so passwords are capped there
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;
export const PASSWORD_PATTERN = /(?=.*[A-Za-z])(?=.*\d)/; // at least one letter and one number

const trimLower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
export const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** An email address, trimmed and lowercased first (emails are stored lowercase). */
export const IsAccountEmail = () =>
  applyDecorators(
    Transform(trimLower),
    IsEmail({}, { message: '$property must be a valid email address' }),
    MaxLength(254),
  );

/** A password being set (register, change, reset): 8-72 characters with a letter and a number. */
export const IsNewPassword = () =>
  applyDecorators(
    IsString(),
    Length(PASSWORD_MIN, PASSWORD_MAX, { message: `$property must be ${PASSWORD_MIN} to ${PASSWORD_MAX} characters` }),
    Matches(PASSWORD_PATTERN, { message: '$property must contain at least one letter and one number' }),
  );

/** A password being checked (login, confirmations): only "present", so old passwords still work. */
export const IsExistingPassword = () =>
  applyDecorators(IsString(), IsNotEmpty({ message: '$property is required' }), MaxLength(PASSWORD_MAX));

/** The 6-digit code from an email. */
export const IsOtpCode = () => applyDecorators(Transform(trim), Matches(/^\d{6}$/, { message: '$property must be 6 digits' }));
