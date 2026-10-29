import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type TopicDocument = HydratedDocument<Topic>;

// ERD: TOPIC (_id, subjectId FK, name, weightage)
@Schema({ collection: 'topics', timestamps: true })
export class Topic {
  // No single-field index: the (subjectId, name) index below also serves lookups by subjectId
  @Prop({ type: Types.ObjectId, ref: 'Subject', required: true })
  subjectId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  // w_t in the diagnostic model (proposal 5.1); weights across all topics sum to 1
  @Prop({ required: true, min: 0, max: 1 })
  weightage!: number;
}

export const TopicSchema = SchemaFactory.createForClass(Topic);
// The same topic name must not appear twice in one subject
TopicSchema.index({ subjectId: 1, name: 1 }, { unique: true });
