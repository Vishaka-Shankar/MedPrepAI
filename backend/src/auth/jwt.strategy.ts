import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppEnv } from '../config/env';
import { PublicUser, UsersService } from '../users/users.service';

/** What we put inside the token when a user logs in. */
export interface JwtPayload {
  sub: string; // user id
  email: string;
  role: string;
  tv: number; // the user's tokenVersion when the token was made
}

export const SESSION_EXPIRED = 'Your session has ended because the password was changed. Please log in again.';

/**
 * Checks the token's signature and expiry (passport-jwt does this),
 * then loads the user so a deleted account can no longer use an old token,
 * and compares token versions so a password change logs out every older session.
 * request.user always comes fresh from the database, so a role change applies at once.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService<AppEnv, true>,
    private readonly users: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET', { infer: true }),
    });
  }

  async validate(payload: JwtPayload): Promise<PublicUser> {
    const state = await this.users.findAuthState(payload.sub);
    if (!state) throw new UnauthorizedException('User no longer exists');
    // Tokens made before this feature have no "tv"; they count as version 0
    if ((payload.tv ?? 0) !== state.tokenVersion) throw new UnauthorizedException(SESSION_EXPIRED);
    return state.user; // becomes request.user
  }
}
