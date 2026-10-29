import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CohortMemberDocument = HydratedDocument<CohortMember>;

// ERD: COHORT_MEMBER (cohortId FK, userId FK, consentAt)
// FYP-II: schema only for now.
@Schema({ collection: 'cohort_members', timestamps: true })
export class CohortMember {
  @Prop({ type: Types.ObjectId, ref: 'Cohort', required: true })
  cohortId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  // Student consents to the instructor seeing their progress
  @Prop({ required: true })
  consentAt!: Date;
}

export const CohortMemberSchema = SchemaFactory.createForClass(CohortMember);
// A student joins a cohort only once
CohortMemberSchema.index({ cohortId: 1, userId: 1 }, { unique: true });
