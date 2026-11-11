import { IsAccountEmail, IsNewPassword, IsPersonName } from './validators';

export class RegisterDto {
  @IsPersonName()
  name!: string;

  @IsAccountEmail()
  email!: string;

  @IsNewPassword()
  password!: string;
}
