import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { PublicUser } from '../users/users.service';

/** Gives a controller the logged-in user that JwtStrategy attached to the request. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PublicUser =>
    ctx.switchToHttp().getRequest<{ user: PublicUser }>().user,
);
