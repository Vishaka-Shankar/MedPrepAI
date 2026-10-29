import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export const SOURCE_TYPES = ['syllabus', 'past_paper', 'textbook'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export type SourceDocumentDocument = HydratedDocument<SourceDocument>;

// ERD: SOURCE_DOCUMENT (doc_id PK, subjectId FK, ingestionRunId FK, type, source, board)
@Schema({ collection: 'source_documents', timestamps: true })
export class SourceDocument {
  // null for a mixed file (MDCAT syllabus / past paper): its chunks carry their own subjectId
  @Prop({ type: Types.ObjectId, ref: 'Subject', index: true, default: null })
  subjectId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'IngestionRun', required: true, index: true })
  ingestionRunId!: Types.ObjectId;

  @Prop({ type: String, required: true, enum: SOURCE_TYPES })
  type!: SourceType;

  // File name or URL the text came from, shown in citations
  @Prop({ required: true, trim: true })
  source!: string;

  // Exam / textbook board, e.g. "PMDC", "Sindh", "Federal"
  @Prop({ type: String, trim: true, default: null })
  board?: string | null;

  // Ingestion bookkeeping (written by rag-service):
  // SHA-256 of the PDF file, so the same file is never registered twice
  @Prop({ required: true, unique: true })
  fileHash!: string;

  @Prop({ min: 0 })
  pages?: number;

  // How many pages were scanned images and needed Tesseract OCR
  @Prop({ min: 0 })
  ocrPages?: number;

  // Set when every chunk of the file is stored; re-runs skip files that have it
  @Prop()
  ingestedAt?: Date;

  // true for SAMPLE_*.pdf test data, so it can be deleted later
  @Prop({ default: false })
  isSample!: boolean;
}

export const SourceDocumentSchema = SchemaFactory.createForClass(SourceDocument);
