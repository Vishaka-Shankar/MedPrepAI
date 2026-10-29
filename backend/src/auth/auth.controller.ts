import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { PublicUser } from '../users/users.service';
import { AuthResponse, AuthService, RegisterResponse } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto, ResendOtpDto, ResetPasswordDto, VerifyOtpDto } from './dto/verify-otp.dto';
import { Public } from './public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** POST /auth/register -> 201 { message, email }. Emails a 6-digit code; no token yet. */
  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<RegisterResponse> {
    return this.auth.register(dto);
  }

  /** POST /auth/verify-otp { email, code } -> 200 { accessToken, user }. At most 10 tries a minute per IP. */
  @Public()
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  verifyOtp(@Body() dto: VerifyOtpDto): Promise<AuthResponse> {
    return this.auth.verifyOtp(dto);
  }

  /** POST /auth/resend-otp { email } -> 200 { message } (always the same). At most 3 a minute per IP. */
  @Public()
  @Post('resend-otp')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  resendOtp(@Body() dto: ResendOtpDto): Promise<{ message: string }> {
    return this.auth.resendOtp(dto);
  }

  /** POST /auth/forgot-password { email } -> 200 { message } (always the same). At most 3 a minute per IP. */
  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  forgotPassword(@Body() dto: ForgotPasswordDto): Promise<{ message: string }> {
    return this.auth.forgotPassword(dto);
  }

  /** POST /auth/reset-password { email, code, newPassword } -> 200 { message }. At most 10 tries a minute per IP. */
  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  resetPassword(@Body() dto: ResetPasswordDto): Promise<{ message: string }> {
    return this.auth.resetPassword(dto);
  }

  /** POST /auth/login -> 200 { accessToken, user }; 401 generic; 403 EMAIL_NOT_VERIFIED */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<AuthResponse> {
    return this.auth.login(dto);
  }

  /** GET /auth/me (needs Bearer token) -> 200 { id, name, email, role, emailVerified } */
  @Get('me')
  me(@CurrentUser() user: PublicUser): PublicUser {
    return user;
  }
}
