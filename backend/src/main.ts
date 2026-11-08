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

import * as dns from 'dns';

// Some networks/antivirus make Node's default resolver (127.0.0.1) refuse SRV lookups.
// Set DNS_SERVERS=1.1.1.1,8.8.8.8 to bypass it. Does nothing when unset.
const dnsServers = (process.env.DNS_SERVERS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (dnsServers.length > 0) {
  dns.setServers(dnsServers);
}

void bootstrap();

