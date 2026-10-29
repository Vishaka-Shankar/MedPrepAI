import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PublicUser, UsersService } from '../users/users.service';
import { JwtPayload } from './jwt.strategy';

/** Signs access tokens. Used by login, verify-otp and a password change (which gets a fresh token). */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly users: UsersService,
  ) {}

  /** A token carrying the user's CURRENT tokenVersion, read from the database. */
  async issue(user: PublicUser): Promise<string> {
    const state = await this.users.findAuthState(user.id);
    if (!state) throw new UnauthorizedException('User no longer exists');
    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role, tv: state.tokenVersion };
    return this.jwt.signAsync(payload);
  }
}
