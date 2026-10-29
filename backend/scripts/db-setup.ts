/**
 * npm run db:setup
 *
 * 1. Connects to MongoDB Atlas and pings it (tests MONGODB_URI).
 * 2. Creates every ERD collection and its indexes (unique keys, foreign-key lookups).
 * 3. Creates the Atlas Vector Search index described in rag-service/atlas_index.json
 *    (generated from rag-service/config.py; default: chunk_vector_index_384 on embedding384, 384 dims).
 *    Other vector indexes (e.g. the old 1024-d chunk_vector_index) are left as they are.
 *
 * Safe to run many times: existing collections and indexes are left as they are.
 */
import 'reflect-metadata';
import * as path from 'path';
import { config as loadDotenv } from 'dotenv';
import mongoose from 'mongoose';
import { validateEnv } from '../src/config/env';
import { ALL_MODELS } from '../src/schemas';
import { loadAtlasIndex, vectorField } from './atlas-index';

loadDotenv({ path: path.resolve(__dirname, '../../.env') });

async function main() {
  const env = validateEnv(process.env);

  console.log('Connecting to MongoDB...');
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  const db = mongoose.connection.db;
  if (!db) throw new Error('Connected, but no database handle is available');
  await db.admin().ping();
  console.log(`Connected. Database: "${db.databaseName}"\n`);

  console.log('Collections and indexes:');
  for (const { name, schema } of ALL_MODELS) {
    const model = mongoose.model(name, schema);
    await model.createCollection();
    await model.syncIndexes();
    const indexes = await model.collection.indexes();
    const names = indexes.map((i) => i.name).filter((n) => n !== '_id_');
    console.log(`  ${model.collection.collectionName.padEnd(18)} ${names.join(', ') || '(only _id)'}`);
  }

  await createVectorIndex(db);
  console.log('\nDone.');
}

async function createVectorIndex(db: NonNullable<typeof mongoose.connection.db>) {
  const chunks = db.collection('chunks');
  // One source of truth: the same JSON the Atlas UI steps in the README use
  const index = loadAtlasIndex();
  const vector = vectorField(index);
  try {
    const existing = await chunks.listSearchIndexes(index.name).toArray();
    if (existing.length > 0) {
      console.log(`\nVector index "${index.name}" already exists (status: ${String((existing[0] as { status?: string }).status)}).`);
      return;
    }
    // Filters on subjectId and topicId let RAG queries be restricted to one subject or one topic
    await chunks.createSearchIndex({ name: index.name, type: index.type, definition: index.definition });
    console.log(
      `\nVector index "${index.name}" on ${vector.path} (${vector.numDimensions} dims) created (Atlas builds it in the background, ~1 min).`,
    );
  } catch (err) {
    // Only Atlas supports search indexes; a local MongoDB will land here
    console.warn(`\nWARNING: could not create the vector index: ${(err as Error).message}`);
    console.warn('Atlas Vector Search needs a MongoDB Atlas cluster. Everything else is set up.');
  }
}

main()
  .catch((err: Error) => {
    console.error(`\nDatabase setup FAILED: ${err.message}`);
    if (/ECONNREFUSED|querySrv|timed out|Server selection/i.test(err.message)) {
      console.error('Check MONGODB_URI and that your IP is allowed in Atlas > Network Access.');
    }
    if (/auth|bad auth/i.test(err.message)) {
      console.error('Check the username and password in MONGODB_URI (Atlas > Database Access).');
    }
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
