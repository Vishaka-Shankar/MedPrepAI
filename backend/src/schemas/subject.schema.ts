import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type SubjectDocument = HydratedDocument<Subject>;

// ERD: SUBJECT (_id, code UK, name, weightShare)
@Schema({ collection: 'subjects', timestamps: true })
export class Subject {
  // e.g. "BIO", "CHEM", "PHY"
  @Prop({ required: true, unique: true, uppercase: true, trim: true })
  code!: string;

  @Prop({ required: true, trim: true })
  name!: string;

  // Share of the 200 MDCAT MCQs, e.g. Biology 68/200 = 0.34 (proposal Figure 1)
  @Prop({ required: true, min: 0, max: 1 })
  weightShare!: number;
}

export const SubjectSchema = SchemaFactory.createForClass(Subject);
