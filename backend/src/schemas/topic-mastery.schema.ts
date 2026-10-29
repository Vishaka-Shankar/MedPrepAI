import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/** Starting mastery when there is no evidence yet (proposal 5.1). */
export const INITIAL_MASTERY = 0.5;

export type TopicMasteryDocument = HydratedDocument<TopicMastery>;

// ERD: TOPIC_MASTERY (_id, userId FK, topicId FK, mastery, attemptCount)
// M_t in the diagnostic model: M_t <- (1 - alpha) * M_t + alpha * c
@Schema({ collection: 'topic_mastery', timestamps: true })
export class TopicMastery {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Topic', required: true })
  topicId!: Types.ObjectId;

  @Prop({ required: true, min: 0, max: 1, default: INITIAL_MASTERY })
  mastery!: number;

  // Topics with fewer than 5 attempts are shown as "insufficient data"
  @Prop({ required: true, min: 0, default: 0 })
  attemptCount!: number;
}

export const TopicMasterySchema = SchemaFactory.createForClass(TopicMastery);
// Exactly one mastery row per (user, topic)
TopicMasterySchema.index({ userId: 1, topicId: 1 }, { unique: true });
