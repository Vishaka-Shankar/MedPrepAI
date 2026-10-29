import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { AccountService, UserListResponse } from './account.service';
import {
  ChangeEmailDto,
  ChangePasswordDto,
  ConfirmEmailChangeDto,
  DeleteAccountDto,
  ListUsersQueryDto,
  UpdateProfileDto,
  UpdateRoleDto,
} from './dto/account.dto';
import { PublicUser } from './users.service';

/**
 * Every route needs a JWT (global JwtAuthGuard). /users/me routes act on the caller only;
 * the others need the admin role. The /me routes come first so "me" is never read as an :id.
 */
@Controller('users')
export class UsersController {
  constructor(private readonly account: AccountService) {}

  // ---------- own account ----------

  /** GET /users/me -> the caller's profile (never the password hash). */
  @Get('me')
  me(@CurrentUser() user: PublicUser): PublicUser {
    return user;
  }

  /** PATCH /users/me { name } -> the updated profile. */
  @Patch('me')
  updateMe(@CurrentUser() user: PublicUser, @Body() dto: UpdateProfileDto): Promise<PublicUser> {
    return this.account.updateProfile(user.id, dto.name);
  }

  /** PATCH /users/me/password { currentPassword, newPassword } -> { message, accessToken }; other sessions end. */
  @Patch('me/password')
  changePassword(@CurrentUser() user: PublicUser, @Body() dto: ChangePasswordDto) {
    return this.account.changePassword(user.id, dto.currentPassword, dto.newPassword);
  }

  /** POST /users/me/change-email { newEmail, password } -> 200 { message, email }; emails a code to the new address. */
  @Post('me/change-email')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  requestEmailChange(@CurrentUser() user: PublicUser, @Body() dto: ChangeEmailDto) {
    return this.account.requestEmailChange(user, dto.newEmail, dto.password);
  }

  /** POST /users/me/change-email/verify { code } -> 200 { message, user }. */
  @Post('me/change-email/verify')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  confirmEmailChange(@CurrentUser() user: PublicUser, @Body() dto: ConfirmEmailChangeDto) {
    return this.account.confirmEmailChange(user.id, dto.code);
  }

  /** DELETE /users/me { password } -> 200 { message }; also deletes the user's chats, citations and codes. */
  @Delete('me')
  deleteMe(@CurrentUser() user: PublicUser, @Body() dto: DeleteAccountDto) {
    return this.account.deleteOwnAccount(user.id, dto.password);
  }

  // ---------- admin ----------

  /** GET /users?page&limit&search (admin) -> { items, page, limit, total, totalPages }. */
  @Get()
  @Roles('admin')
  list(@Query() query: ListUsersQueryDto): Promise<UserListResponse> {
    return this.account.list(query.page, query.limit, query.search);
  }

  /** GET /users/:id (admin). */
  @Get(':id')
  @Roles('admin')
  getOne(@Param('id') id: string): Promise<PublicUser> {
    return this.account.getById(id);
  }

  /** PATCH /users/:id/role { role: "student" | "admin" } (admin, not on themselves). */
  @Patch(':id/role')
  @Roles('admin')
  setRole(@CurrentUser() admin: PublicUser, @Param('id') id: string, @Body() dto: UpdateRoleDto): Promise<PublicUser> {
    return this.account.setRole(admin, id, dto.role);
  }

  /** DELETE /users/:id (admin, not on themselves). */
  @Delete(':id')
  @Roles('admin')
  remove(@CurrentUser() admin: PublicUser, @Param('id') id: string) {
    return this.account.deleteByAdmin(admin, id);
  }
}
