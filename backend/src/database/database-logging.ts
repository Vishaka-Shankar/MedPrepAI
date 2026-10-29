import { Logger } from '@nestjs/common';
import { Connection } from 'mongoose';

const logger = new Logger('Database');

/** If a connection fails with one of these, the cause is almost always the network, not our code. */
export const NETWORK_HINT =
  'Check your internet connection and that Atlas > Network Access allows this computer\'s IP address.';

/**
 * "medprep on vishaka-golani.pi2pr8s.mongodb.net": database name and host only.
 * The user name and password in the URI are never logged.
 */
export function describeMongoUri(uri: string): string {
  const match = uri.match(/^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)\/?([^?]*)/);
  if (!match) return '(unreadable MONGODB_URI)';
  const [, host, dbName] = match;
  return `${dbName || '(default database "test")'} on ${host}`;
}

/** Logs connect / disconnect / errors, so a broken database is visible in the server log. */
export function attachDatabaseLogging(connection: Connection, uri: string): Connection {
  const target = describeMongoUri(uri);
  connection.on('connected', () => logger.log(`Connected to MongoDB: database "${connection.name}" (${target})`));
  connection.on('disconnected', () => logger.warn(`Disconnected from MongoDB (${target}). ${NETWORK_HINT}`));
  connection.on('reconnected', () => logger.log(`Reconnected to MongoDB (${target})`));
  connection.on('error', (err: Error) => logger.error(`MongoDB connection error: ${err.message}. ${NETWORK_HINT}`));
  return connection;
}
