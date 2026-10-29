import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export const QUIZ_MODES = ['topic', 'adaptive'] as const;
export type QuizMode = (typeof QUIZ_MODES)[number];

export const QUIZ_STATUSES = ['in_progress', 'completed'] as const;
export type QuizStatus = (typeof QUIZ_STATUSES)[number];

export type QuizSessionDocument = HydratedDocument<QuizSession>;

// ERD: QUIZ_SESSION (_id, userId FK, topicId FK, mode, timeLimit, status, score)
@Schema({ collection: 'quiz_sessions', timestamps: true })
export class QuizSession {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  // Empty for adaptive quizzes, which mix topics by priority
  @Prop({ type: Types.ObjectId, ref: 'Topic' })
  topicId?: Types.ObjectId;

  @Prop({ type: String, required: true, enum: QUIZ_MODES })
  mode!: QuizMode;

  // Seconds; empty = untimed
  @Prop({ min: 1 })
  timeLimit?: number;

  @Prop({ type: String, required: true, enum: QUIZ_STATUSES, default: 'in_progress' })
  status!: QuizStatus;

  // Number of correct answers
  @Prop({ required: true, min: 0, default: 0 })
  score!: number;
}

export const QuizSessionSchema = SchemaFactory.createForClass(QuizSession);
// "My recent quizzes" query
QuizSessionSchema.index({ userId: 1, createdAt: -1 });
