import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OtpCode, OtpCodeSchema } from '../schemas/otp-code.schema';
import { OtpService } from './otp.service';

/** One-time codes, shared by AuthModule (verify email, reset password) and AccountModule (change email). */
@Module({
  imports: [MongooseModule.forFeature([{ name: OtpCode.name, schema: OtpCodeSchema }])],
  providers: [OtpService],
  exports: [OtpService],
})
export class OtpModule {}
