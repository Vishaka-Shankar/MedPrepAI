import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CohortDocument = HydratedDocument<Cohort>;

// ERD: COHORT (_id, instructorId FK, name, joinCode UK)
// FYP-II (cohort / instructor dashboard): schema only for now.
@Schema({ collection: 'cohorts', timestamps: true })
export class Cohort {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  instructorId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, unique: true, uppercase: true, trim: true })
  joinCode!: string;
}

export const CohortSchema = SchemaFactory.createForClass(Cohort);
