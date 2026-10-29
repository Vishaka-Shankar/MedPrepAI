import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PilotFeedbackDocument = HydratedDocument<PilotFeedback>;

// ERD: PILOT_FEEDBACK (_id, userId FK, consentAt, susScore, usefulness)
// Used in milestone M7 (pilot testing): schema only for now.
@Schema({ collection: 'pilot_feedback', timestamps: true })
export class PilotFeedback {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  userId!: Types.ObjectId;

  // Informed consent is required before any feedback is stored
  @Prop({ required: true })
  consentAt!: Date;

  // System Usability Scale, 0-100
  @Prop({ min: 0, max: 100 })
  susScore?: number;

  // Likert rating, 1-5
  @Prop({ min: 1, max: 5 })
  usefulness?: number;
}

export const PilotFeedbackSchema = SchemaFactory.createForClass(PilotFeedback);
