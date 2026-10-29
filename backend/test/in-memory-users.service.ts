import { AuthState, PublicUser } from '../src/users/users.service';

interface StoredUser extends PublicUser {
  passwordHash: string;
  tokenVersion: number;
}

/**
 * Test double for UsersService: same methods, but keeps users in an array
 * instead of MongoDB, so tests are fast and need no database.
 */
export class InMemoryUsersService {
  users: StoredUser[] = [];
  private nextId = 1;

  async findById(id: string): Promise<PublicUser | null> {
    const user = this.users.find((u) => u.id === id);
    return user ? strip(user) : null;
  }

  async findAuthState(id: string): Promise<AuthState | null> {
    const user = this.users.find((u) => u.id === id);
    return user ? { user: strip(user), tokenVersion: user.tokenVersion } : null;
  }

  async setPassword(id: string, passwordHash: string, markEmailVerified = false): Promise<number | null> {
    const user = this.users.find((u) => u.id === id);
    if (!user) return null;
    user.passwordHash = passwordHash;
    if (markEmailVerified) user.emailVerified = true;
    return ++user.tokenVersion;
  }

  async findByEmail(email: string): Promise<PublicUser | null> {
    const user = this.users.find((u) => u.email === email);
    return user ? strip(user) : null;
  }

  async findByEmailWithPassword(email: string) {
    return this.users.find((u) => u.email === email) ?? null;
  }

  async existsByEmail(email: string): Promise<boolean> {
    return this.users.some((u) => u.email === email);
  }

  async create(data: { name: string; email: string; passwordHash: string }): Promise<PublicUser> {
    const id = (this.nextId++).toString(16).padStart(24, '0');
    const user: StoredUser = { id, role: 'student', emailVerified: false, tokenVersion: 0, ...data };
    this.users.push(user);
    return strip(user);
  }

  async markEmailVerified(id: string): Promise<void> {
    const user = this.users.find((u) => u.id === id);
    if (user) user.emailVerified = true;
  }

  async deleteUnverified(id: string): Promise<void> {
    this.users = this.users.filter((u) => !(u.id === id && !u.emailVerified));
  }
}

function strip({ passwordHash: _hash, tokenVersion: _tv, ...user }: StoredUser): PublicUser {
  return user;
}
