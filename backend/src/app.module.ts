import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { ChatModule } from './chat/chat.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { AccountModule } from './users/account.module';
import { Connection } from 'mongoose';
import { AppEnv, validateEnv } from './config/env';
import { attachDatabaseLogging } from './database/database-logging';
import { ALL_MODELS } from './schemas';

@Module({
  imports: [
    // One .env file at the repo root is shared by backend and rag-service
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../.env'], validate: validateEnv }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnv, true>) => {
        const uri = config.get('MONGODB_URI', { infer: true });
        return {
          uri,
          // Indexes are created by `npm run db:setup`, not on every app start
          autoIndex: false,
          // Give up after 5 s if the database can't be reached (default 30 s). The request then
          // fails with a clear 503 before the browser's own 15 s timeout hides the real reason.
          serverSelectionTimeoutMS: 5000,
          // Don't queue queries while disconnected (Mongoose would wait 10 s and throw a different
          // error); send them to the driver, which reports the outage as a clear error -> 503
          bufferCommands: false,
          // Log connect / disconnect / errors with the database name (never the password).
          // onConnectionCreate runs BEFORE the first connection attempt, so startup failures are explained too.
          onConnectionCreate: (connection: Connection) => attachDatabaseLogging(connection, uri),
          // On a failed start, print the reason with each "Unable to connect... Retrying" line
          verboseRetryLog: true,
        };
      },
    }),
    // Register every ERD collection so later modules can inject any model
    MongooseModule.forFeature(ALL_MODELS),
    AuthModule,
    AccountModule,
    ChatModule,
  ],
  controllers: [AppController],
  // Every route requires a valid JWT unless it is marked @Public(); then @Roles() is checked.
  // Global guards run in this order, so RolesGuard always sees the logged-in user.
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
