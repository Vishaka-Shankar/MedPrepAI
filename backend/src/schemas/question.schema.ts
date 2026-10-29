import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type QuestionDocument = HydratedDocument<Question>;

// ERD: QUESTION (_id, topicId FK, sourceChunkIds FK, year, stem, options, answerKey, aiGenerated)
@Schema({ collection: 'questions', timestamps: true })
export class Question {
  @Prop({ type: Types.ObjectId, ref: 'Topic', required: true, index: true })
  topicId!: Types.ObjectId;

  // Chunks the question (or its explanation) is grounded in
  @Prop({ type: [{ type: Types.ObjectId, ref: 'Chunk' }], default: [] })
  sourceChunkIds!: Types.ObjectId[];

  // Past-paper year; empty for AI-generated questions
  @Prop({ min: 2000, max: 2100 })
  year?: number;

  @Prop({ required: true, trim: true })
  stem!: string;

  @Prop({
    type: [String],
    required: true,
    validate: {
      validator: (v: string[]) => v.length >= 2,
      message: 'A question needs at least two options',
    },
  })
  options!: string[];

  // 0-based index into `options`
  @Prop({ required: true, min: 0 })
  answerKey!: number;

  @Prop({ required: true, default: false })
  aiGenerated!: boolean;
}

export const QuestionSchema = SchemaFactory.createForClass(Question);
