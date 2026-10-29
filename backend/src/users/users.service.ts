import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, isValidObjectId, Model } from 'mongoose';
import { User, UserDocument, UserRole } from '../schemas/user.schema';

/** The only user shape that ever leaves the backend (no passwordHash, no tokenVersion). */
export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  emailVerified: boolean;
}

/** What JwtStrategy needs: the user, plus the token version their tokens must carry. */
export interface AuthState {
  user: PublicUser;
  tokenVersion: number;
}

export interface UserPage {
  items: PublicUser[];
  total: number;
}

export function toPublicUser(user: UserDocument): PublicUser {
  return { id: user.id as string, name: user.name, email: user.email, role: user.role, emailVerified: user.emailVerified };
}

/** Lets a search like "a.b+c" match those characters literally instead of as a regex. */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Database access for users. Business rules (who may do what) live in AuthService and AccountService. */
@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private readonly userModel: Model<User>) {}

  async findById(id: string): Promise<PublicUser | null> {
    if (!isValidObjectId(id)) return null;
    const user = await this.userModel.findById(id).exec();
    return user ? toPublicUser(user) : null;
  }

  async findAuthState(id: string): Promise<AuthState | null> {
    if (!isValidObjectId(id)) return null;
    const user = await this.userModel.findById(id).exec();
    return user ? { user: toPublicUser(user), tokenVersion: user.tokenVersion ?? 0 } : null;
  }

  async findByEmail(email: string): Promise<PublicUser | null> {
    const user = await this.userModel.findOne({ email }).exec();
    return user ? toPublicUser(user) : null;
  }

  /** Includes passwordHash (hidden by default in the schema) - only for login. */
  findByEmailWithPassword(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email }).select('+passwordHash').exec();
  }

  /** Includes passwordHash - only for checking the password before a sensitive change. */
  findByIdWithPassword(id: string): Promise<UserDocument | null> {
    if (!isValidObjectId(id)) return Promise.resolve(null);
    return this.userModel.findById(id).select('+passwordHash').exec();
  }

  async existsByEmail(email: string): Promise<boolean> {
    return (await this.userModel.exists({ email })) !== null;
  }

  async create(data: { name: string; email: string; passwordHash: string }): Promise<PublicUser> {
    // role is never taken from the request: everyone who signs up is a student,
    // and nobody is verified until they enter the emailed code
    const user = await this.userModel.create({ ...data, role: 'student', emailVerified: false });
    return toPublicUser(user);
  }

  async markEmailVerified(id: string): Promise<void> {
    await this.userModel.updateOne({ _id: id }, { $set: { emailVerified: true } }).exec();
  }

  /** Undo a registration whose verification email could not be sent, so the user can simply try again. */
  async deleteUnverified(id: string): Promise<void> {
    await this.userModel.deleteOne({ _id: id, emailVerified: false }).exec();
  }

  /** Newest first. `search` matches part of the name or email, ignoring case. */
  async list(page: number, limit: number, search?: string): Promise<UserPage> {
    const filter: FilterQuery<User> = {};
    if (search) {
      const pattern = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ name: pattern }, { email: pattern }];
    }
    const [docs, total] = await Promise.all([
      this.userModel
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.userModel.countDocuments(filter).exec(),
    ]);
    return { items: docs.map(toPublicUser), total };
  }

  async updateName(id: string, name: string): Promise<PublicUser | null> {
    const user = await this.userModel.findByIdAndUpdate(id, { $set: { name } }, { new: true, runValidators: true }).exec();
    return user ? toPublicUser(user) : null;
  }

  /**
   * Save a new password hash and add 1 to tokenVersion, which logs out every existing session.
   * A reset also proves the user owns the email, so it can mark the email verified.
   * Returns the new token version (null if the user is gone).
   */
  async setPassword(id: string, passwordHash: string, markEmailVerified = false): Promise<number | null> {
    const set: Partial<User> = { passwordHash };
    if (markEmailVerified) set.emailVerified = true;
    const user = await this.userModel.findByIdAndUpdate(id, { $set: set, $inc: { tokenVersion: 1 } }, { new: true }).exec();
    return user ? user.tokenVersion : null;
  }

  /** May throw a duplicate-key error (code 11000) if another account took the email meanwhile. */
  async updateEmail(id: string, email: string): Promise<PublicUser | null> {
    const user = await this.userModel.findByIdAndUpdate(id, { $set: { email } }, { new: true }).exec();
    return user ? toPublicUser(user) : null;
  }

  async setRole(id: string, role: UserRole): Promise<PublicUser | null> {
    if (!isValidObjectId(id)) return null;
    const user = await this.userModel.findByIdAndUpdate(id, { $set: { role } }, { new: true }).exec();
    return user ? toPublicUser(user) : null;
  }

  async deleteById(id: string): Promise<boolean> {
    const result = await this.userModel.deleteOne({ _id: id }).exec();
    return result.deletedCount === 1;
  }
}
