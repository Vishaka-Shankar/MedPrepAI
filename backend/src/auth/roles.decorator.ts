import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../schemas/user.schema';

export const ROLES_KEY = 'roles';

/** Only users with one of these roles may call the route, e.g. @Roles('admin'). Checked by RolesGuard. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
