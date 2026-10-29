import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { AppEnv } from './config/env';
import { describeMongoUri } from './database/database-logging';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  const env = app.get<ConfigService<AppEnv, true>>(ConfigService);

  configureApp(app, env.get('FRONTEND_ORIGIN', { infer: true }));

  const port = env.get('PORT', { infer: true });
  await app.listen(port);
  logger.log(`MedPrep API running on http://localhost:${port}`);
  // Which database this server uses (never the password)
  logger.log(`Database: ${describeMongoUri(env.get('MONGODB_URI', { infer: true }))}`);
  logger.log(`CORS allows: ${env.get('FRONTEND_ORIGIN', { infer: true })}`);
}

void bootstrap();
