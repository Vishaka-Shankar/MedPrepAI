import { IsAccountEmail, IsExistingPassword } from './validators';

export class LoginDto {
  @IsAccountEmail()
  email!: string;

  @IsExistingPassword()
  password!: string;
}
