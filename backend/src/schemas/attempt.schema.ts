import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AttemptDocument = HydratedDocument<Attempt>;

// ERD: ATTEMPT (_id, userId FK, questionId FK, quizSessionId FK, selectedOption, correct, timestamp)
// One row per answered question; this is the input to the diagnostic engine.
@Schema({ collection: 'attempts', timestamps: true })
export class Attempt {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Question', required: true })
  questionId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'QuizSession', required: true, index: true })
  quizSessionId!: Types.ObjectId;

  // 0-based index into the question's options
  @Prop({ required: true, min: 0 })
  selectedOption!: number;

  @Prop({ required: true })
  correct!: boolean;

  @Prop({ required: true, default: () => new Date() })
  timestamp!: Date;
}

export const AttemptSchema = SchemaFactory.createForClass(Attempt);
// Dashboard: a user's attempts in time order
AttemptSchema.index({ userId: 1, timestamp: -1 });
