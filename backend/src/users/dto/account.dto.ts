import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { IsAccountEmail, IsExistingPassword, IsNewPassword, IsOtpCode, IsPersonName, trim } from '../../auth/dto/validators';

export const MAX_PAGE_SIZE = 50;
export const DEFAULT_PAGE_SIZE = 20;
/** Roles an admin may give through PATCH /users/:id/role ("instructor" is FYP-II). */
export const ASSIGNABLE_ROLES = ['student', 'admin'] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export class UpdateProfileDto {
  @IsPersonName()
  name!: string;
}

export class ChangePasswordDto {
  @IsExistingPassword()
  currentPassword!: string;

  @IsNewPassword()
  newPassword!: string;
}

export class ChangeEmailDto {
  @IsAccountEmail()
  newEmail!: string;

  @IsExistingPassword()
  password!: string;
}

export class ConfirmEmailChangeDto {
  @IsOtpCode()
  code!: string;
}

export class DeleteAccountDto {
  @IsExistingPassword()
  password!: string;
}

/** GET /users?page=1&limit=20&search=ayesha (query values arrive as strings, so @Type converts them). */
export class ListUsersQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be a whole number' })
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be a whole number' })
  @Min(1)
  @Max(MAX_PAGE_SIZE, { message: `limit must not be greater than ${MAX_PAGE_SIZE}` })
  limit: number = DEFAULT_PAGE_SIZE;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class UpdateRoleDto {
  @IsIn(ASSIGNABLE_ROLES, { message: `role must be one of: ${ASSIGNABLE_ROLES.join(', ')}` })
  role!: AssignableRole;
}
