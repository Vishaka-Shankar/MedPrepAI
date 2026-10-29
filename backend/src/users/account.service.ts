import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Model, Types } from 'mongoose';
import { BCRYPT_ROUNDS, isDuplicateKeyError } from '../auth/auth.service';
import { otpFailure } from '../auth/otp-errors';
import { OTP_VALID_MINUTES, OtpService } from '../auth/otp.service';
import { TokenService } from '../auth/token.service';
import { MailService } from '../mail/mail.service';
import { ChatMessage } from '../schemas/chat-message.schema';
import { Citation } from '../schemas/citation.schema';
import { AssignableRole } from './dto/account.dto';
import { PublicUser, UsersService } from './users.service';

export const WRONG_PASSWORD = 'Your password is incorrect';
export const EMAIL_IN_USE = 'An account with this email already exists';
export const USER_NOT_FOUND = 'User not found';

export interface UserListResponse {
  items: PublicUser[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * Everything a logged-in user can do to their own account, and what an admin can do to others.
 * UsersService only talks to the database; the rules live here.
 */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly users: UsersService,
    private readonly otp: OtpService,
    private readonly mail: MailService,
    private readonly tokens: TokenService,
    @InjectModel(ChatMessage.name) private readonly chatModel: Model<ChatMessage>,
    @InjectModel(Citation.name) private readonly citationModel: Model<Citation>,
  ) {}

  // ---------- own account ----------

  async updateProfile(userId: string, name: string): Promise<PublicUser> {
    const user = await this.users.updateName(userId, name);
    if (!user) throw new NotFoundException(USER_NOT_FOUND);
    return user;
  }

  /** Change the password. Every other session is logged out; this one gets a fresh token. */
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const hash = await this.checkPassword(userId, currentPassword);
    if (await bcrypt.compare(newPassword, hash)) {
      throw new BadRequestException('Your new password must be different from your current password');
    }

    await this.users.setPassword(userId, await bcrypt.hash(newPassword, BCRYPT_ROUNDS));
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException(USER_NOT_FOUND);
    this.logger.log(`Password changed for user ${userId}; older sessions logged out`);
    return { message: 'Password changed. You were logged out on other devices.', accessToken: await this.tokens.issue(user) };
  }

  /** Step 1 of an email change: check the password, then send a code to the NEW address. */
  async requestEmailChange(user: PublicUser, newEmail: string, password: string): Promise<{ message: string; email: string }> {
    if (newEmail === user.email) throw new BadRequestException('This is already your email address');
    await this.checkPassword(user.id, password); // before the 409, so the route can't probe emails without the password
    if (await this.users.existsByEmail(newEmail)) throw new ConflictException(EMAIL_IN_USE);

    const wait = await this.otp.secondsUntilResend(user.id, 'change_email');
    if (wait > 0) {
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, message: `Please wait ${wait} seconds before asking for another code.` },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = await this.otp.issue({ id: user.id, email: newEmail }, 'change_email');
    try {
      await this.mail.sendOtp(newEmail, code, 'change_email', OTP_VALID_MINUTES); // the code is never logged
    } catch (err) {
      await this.otp.discard(user.id, 'change_email'); // unsent code: drop it so the user can try again now
      throw err;
    }
    return { message: 'We sent a 6-digit code to your new email address. It expires in 10 minutes.', email: newEmail };
  }

  /** Step 2: the code proves the user owns the new address, so the change is applied. */
  async confirmEmailChange(userId: string, code: string): Promise<{ message: string; user: PublicUser }> {
    const result = await this.otp.verify(userId, 'change_email', code);
    if (result.status !== 'ok') throw otpFailure(result);

    // Someone may have registered this address during the 10 minutes
    if (await this.users.existsByEmail(result.email)) throw new ConflictException(EMAIL_IN_USE);
    let user: PublicUser | null;
    try {
      user = await this.users.updateEmail(userId, result.email);
    } catch (err) {
      if (isDuplicateKeyError(err)) throw new ConflictException(EMAIL_IN_USE);
      throw err;
    }
    if (!user) throw new NotFoundException(USER_NOT_FOUND);
    this.logger.log(`Email changed for user ${userId}`);
    return { message: 'Your email address has been changed.', user };
  }

  async deleteOwnAccount(userId: string, password: string): Promise<{ message: string }> {
    await this.checkPassword(userId, password);
    await this.deleteUserAndData(userId);
    this.logger.log(`User ${userId} deleted their account`);
    return { message: 'Your account and its data have been deleted.' };
  }

  // ---------- admin ----------

  async list(page: number, limit: number, search?: string): Promise<UserListResponse> {
    const { items, total } = await this.users.list(page, limit, search || undefined);
    return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
  }

  async getById(id: string): Promise<PublicUser> {
    const user = await this.users.findById(id);
    if (!user) throw new NotFoundException(USER_NOT_FOUND);
    return user;
  }

  /** request.user is loaded from the database on every request, so the new role applies at once. */
  async setRole(admin: PublicUser, targetId: string, role: AssignableRole): Promise<PublicUser> {
    // Also guarantees there is always at least one admin left
    if (targetId === admin.id) throw new ForbiddenException('You cannot change your own role');
    const user = await this.users.setRole(targetId, role);
    if (!user) throw new NotFoundException(USER_NOT_FOUND);
    this.logger.log(`Admin ${admin.id} set the role of user ${targetId} to ${role}`);
    return user;
  }

  async deleteByAdmin(admin: PublicUser, targetId: string): Promise<{ message: string }> {
    if (targetId === admin.id) throw new ForbiddenException('Admins cannot delete themselves here. Use DELETE /users/me.');
    await this.getById(targetId); // 404 if missing
    await this.deleteUserAndData(targetId);
    this.logger.log(`Admin ${admin.id} deleted user ${targetId}`);
    return { message: 'User and their data deleted.' };
  }

  // ---------- helpers ----------

  /** Returns the stored hash if `password` is right; 403 otherwise (the user is logged in, so not 401). */
  private async checkPassword(userId: string, password: string): Promise<string> {
    const doc = await this.users.findByIdWithPassword(userId);
    if (!doc) throw new NotFoundException(USER_NOT_FOUND);
    if (!(await bcrypt.compare(password, doc.passwordHash))) {
      this.logger.warn(`Wrong password for user ${userId}`);
      throw new ForbiddenException({ statusCode: 403, code: 'WRONG_PASSWORD', message: WRONG_PASSWORD });
    }
    return doc.passwordHash;
  }

  /**
   * Ordered deletes, children first and the user LAST: citations -> chat_messages -> otp_codes -> user.
   * No transaction: it would need a replica set (Atlas has one, the local test MongoDB doesn't), and
   * with this order a failure halfway leaves the user in place, so simply retrying finishes the job
   * and nothing is ever left pointing at a deleted user.
   */
  private async deleteUserAndData(userId: string): Promise<void> {
    const ownerId = new Types.ObjectId(userId);
    const messageIds = await this.chatModel.distinct('_id', { userId: ownerId }).exec();
    await this.citationModel.deleteMany({ chatMessageId: { $in: messageIds } }).exec();
    await this.chatModel.deleteMany({ userId: ownerId }).exec();
    await this.otp.discardAll(userId);
    await this.users.deleteById(userId);
  }
}
