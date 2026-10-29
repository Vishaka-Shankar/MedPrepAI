import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppEnv } from '../config/env';
import { isTestMode } from '../mail/mail.service';
import { MailModule } from '../mail/mail.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { OtpModule } from './otp.module';
import { TokenService } from './token.service';

@Module({
  imports: [
    UsersModule,
    MailModule,
    PassportModule,
    OtpModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnv, true>): JwtModuleOptions => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: {
          expiresIn: config.get('JWT_EXPIRES_IN', { infer: true }) as JwtExpiresIn,
        },
      }),
    }),
    // Rate limits for the code endpoints (set per route in AuthController and UsersController).
    // ThrottlerModule is global, so the guard works in every module.
    // In tests every request comes from one address, so limits are off unless a test turns them on.
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 10 }],
      errorMessage: 'Too many requests. Please wait a minute and try again.',
      skipIf: () => isTestMode() && process.env.THROTTLE_IN_TESTS !== 'true',
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, TokenService, JwtStrategy],
  exports: [TokenService],
})
export class AuthModule {}

type JwtExpiresIn = NonNullable<NonNullable<JwtModuleOptions['signOptions']>['expiresIn']>;
