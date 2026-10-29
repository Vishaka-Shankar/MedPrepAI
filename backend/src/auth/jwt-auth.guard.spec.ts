import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  const context = { getHandler: () => () => undefined, getClass: () => class {} } as unknown as ExecutionContext;

  it('lets @Public() routes through without checking a token', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(true) } as unknown as Reflector;
    const parent = jest.spyOn(AuthGuard('jwt').prototype, 'canActivate');

    expect(new JwtAuthGuard(reflector).canActivate(context)).toBe(true);
    expect(parent).not.toHaveBeenCalled();
    parent.mockRestore();
  });

  it('checks the JWT on every other route', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) } as unknown as Reflector;
    const parent = jest.spyOn(AuthGuard('jwt').prototype, 'canActivate').mockReturnValue(false);

    expect(new JwtAuthGuard(reflector).canActivate(context)).toBe(false);
    expect(parent).toHaveBeenCalledWith(context);
    parent.mockRestore();
  });
});
