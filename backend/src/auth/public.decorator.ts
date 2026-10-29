import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Every route needs a valid JWT by default (see JwtAuthGuard).
 * Put @Public() on the few routes that must work without logging in.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
