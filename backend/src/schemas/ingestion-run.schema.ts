import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type IngestionRunDocument = HydratedDocument<IngestionRun>;

// ERD: INGESTION_RUN (_id, startedAt, finishedAt, counts)
// Written by rag-service each time it ingests a batch of documents.
@Schema({ collection: 'ingestion_runs', timestamps: true })
export class IngestionRun {
  @Prop({ required: true, default: () => new Date() })
  startedAt!: Date;

  @Prop()
  finishedAt?: Date;

  // e.g. { documents: 12, chunks: 840, errors: 0 }
  @Prop({ type: Object, default: {} })
  counts!: Record<string, number>;
}

export const IngestionRunSchema = SchemaFactory.createForClass(IngestionRun);
