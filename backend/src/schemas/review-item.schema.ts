import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ReviewItemDocument = HydratedDocument<ReviewItem>;

// ERD: REVIEW_ITEM (_id, userId FK, questionId FK, dueAt, intervalDays)
// FYP-II (spaced repetition revision queue): schema only for now.
@Schema({ collection: 'review_items', timestamps: true })
export class ReviewItem {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Question', required: true })
  questionId!: Types.ObjectId;

  @Prop({ required: true })
  dueAt!: Date;

  @Prop({ required: true, min: 1, default: 1 })
  intervalDays!: number;
}

export const ReviewItemSchema = SchemaFactory.createForClass(ReviewItem);
ReviewItemSchema.index({ userId: 1, questionId: 1 }, { unique: true });
// "What is due for me today?"
ReviewItemSchema.index({ userId: 1, dueAt: 1 });
