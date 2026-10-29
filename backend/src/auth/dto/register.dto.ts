import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { IsAccountEmail, IsNewPassword, trim } from './validators';

export class RegisterDto {
  @Transform(trim)
  @IsString()
  @Length(2, 80, { message: 'name must be 2 to 80 characters' })
  name!: string;

  @IsAccountEmail()
  email!: string;

  @IsNewPassword()
  password!: string;
}
