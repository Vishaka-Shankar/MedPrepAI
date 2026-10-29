import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  function contextFor(user: { role: string } | undefined) {
    return {
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
  }
  const guardRequiring = (roles: string[] | undefined) =>
    new RolesGuard({ getAllAndOverride: jest.fn().mockReturnValue(roles) } as unknown as Reflector);

  it('lets any logged-in user through routes without @Roles()', () => {
    expect(guardRequiring(undefined).canActivate(contextFor({ role: 'student' }))).toBe(true);
  });

  it('allows a user with a required role', () => {
    expect(guardRequiring(['admin']).canActivate(contextFor({ role: 'admin' }))).toBe(true);
  });

  it('refuses other roles, or no user at all, with 403', () => {
    expect(() => guardRequiring(['admin']).canActivate(contextFor({ role: 'student' }))).toThrow(ForbiddenException);
    expect(() => guardRequiring(['admin']).canActivate(contextFor(undefined))).toThrow(ForbiddenException);
  });
});
