import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ChunkDocument = HydratedDocument<Chunk>;

// ERD: CHUNK (chunk_id PK, doc_id FK, topicId FK, page, text, embedding, contentHash UK)
// Written by rag-service (ingest.py, scripts/reembed_chunks.py); searched with Atlas Vector Search.
// The model, its field and its index come from rag-service/config.py (see rag-service/atlas_index.json).
@Schema({ collection: 'chunks', timestamps: true })
export class Chunk {
  @Prop({ type: Types.ObjectId, ref: 'SourceDocument', required: true, index: true })
  docId!: Types.ObjectId;

  // Copied from the source document: Atlas Vector Search can only filter on fields
  // of the chunk itself, and RAG queries are filtered by subject
  @Prop({ type: Types.ObjectId, ref: 'Subject', required: true })
  subjectId!: Types.ObjectId;

  // null when no topic could be detected during ingestion
  @Prop({ type: Types.ObjectId, ref: 'Topic', index: true, default: null })
  topicId?: Types.ObjectId | null;

  @Prop({ min: 1 })
  page?: number;

  @Prop({ required: true })
  text!: string;

  // BGE-M3 vectors (1024 dims) from the first ingestion; kept as a backup until their removal is approved
  @Prop({ type: [Number], default: undefined })
  embedding?: number[];

  // bge-small-en-v1.5 vectors (384 dims): the default model since 2026-10-29, index chunk_vector_index_384
  @Prop({ type: [Number], default: undefined })
  embedding384?: number[];

  // SHA-256 of the text, so re-ingesting the same content never creates duplicates
  @Prop({ required: true, unique: true })
  contentHash!: string;

  // true for SAMPLE_*.pdf test data, so it can be deleted later
  @Prop({ default: false })
  isSample!: boolean;
}

export const ChunkSchema = SchemaFactory.createForClass(Chunk);
