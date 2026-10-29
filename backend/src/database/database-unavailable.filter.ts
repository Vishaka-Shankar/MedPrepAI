import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { Error as MongooseError, mongo } from 'mongoose';
import { NETWORK_HINT } from './database-logging';

export const DATABASE_UNAVAILABLE_MESSAGE = 'The database is not reachable right now. Please try again in a minute.';

/**
 * When MongoDB cannot be reached, answer 503 with a clear message instead of a generic 500,
 * so the user knows nothing was saved (e.g. their registration did not happen).
 * The real reason goes to the server log only.
 */
@Catch(mongo.MongoServerSelectionError, mongo.MongoNetworkError, MongooseError.MongooseServerSelectionError)
export class DatabaseUnavailableFilter implements ExceptionFilter {
  private readonly logger = new Logger('Database');

  catch(error: Error, host: ArgumentsHost): void {
    this.logger.error(`Request failed, database unreachable: ${error.message.slice(0, 200)}. ${NETWORK_HINT}`);
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(HttpStatus.SERVICE_UNAVAILABLE)
      .json({ statusCode: HttpStatus.SERVICE_UNAVAILABLE, message: DATABASE_UNAVAILABLE_MESSAGE });
  }
}
