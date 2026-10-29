import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../schemas/user.schema';
import { PublicUser } from '../users/users.service';
import { ROLES_KEY } from './roles.decorator';

export const NOT_ALLOWED = 'You do not have permission to do this';

/**
 * Registered globally after JwtAuthGuard, so request.user is already the logged-in user
 * (loaded fresh from the database). Routes without @Roles() are open to every logged-in user.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest<{ user?: PublicUser }>().user;
    if (!user || !required.includes(user.role)) throw new ForbiddenException(NOT_ALLOWED);
    return true;
  }
}
