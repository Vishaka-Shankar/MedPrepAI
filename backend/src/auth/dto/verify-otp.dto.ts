import { IsAccountEmail, IsNewPassword, IsOtpCode } from './validators';

export class VerifyOtpDto {
  @IsAccountEmail()
  email!: string;

  @IsOtpCode()
  code!: string;
}

/** Body of resend-otp and forgot-password: just the email. */
export class ResendOtpDto {
  @IsAccountEmail()
  email!: string;
}

export class ForgotPasswordDto extends ResendOtpDto {}

export class ResetPasswordDto {
  @IsAccountEmail()
  email!: string;

  @IsOtpCode()
  code!: string;

  @IsNewPassword()
  newPassword!: string;
}
