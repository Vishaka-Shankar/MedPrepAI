import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DatabaseUnavailableFilter } from './database/database-unavailable.filter';

/**
 * Settings shared by the real server (main.ts) and the e2e tests,
 * so the tests run the app exactly as it runs for users.
 */
export function configureApp(app: INestApplication, frontendOrigin: string): void {
  // Validate every request body against its DTO:
  //  whitelist            -> drop fields the DTO does not declare
  //  forbidNonWhitelisted -> and reject the request if any were sent (400)
  //  transform            -> run @Transform (trim, lowercase) before validating
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  // Database unreachable -> 503 with a clear message (not a generic 500)
  app.useGlobalFilters(new DatabaseUnavailableFilter());

  // Only our React app may call the API from a browser
  app.enableCors({ origin: frontendOrigin });
}
