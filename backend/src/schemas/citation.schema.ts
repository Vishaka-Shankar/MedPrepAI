import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CitationDocument = HydratedDocument<Citation>;

// ERD: CITATION (chatMessageId FK, chunkId FK, page, snippet)
// Links a chat answer to the chunks it was grounded in.
@Schema({ collection: 'citations', timestamps: true })
export class Citation {
  @Prop({ type: Types.ObjectId, ref: 'ChatMessage', required: true, index: true })
  chatMessageId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Chunk', required: true })
  chunkId!: Types.ObjectId;

  @Prop({ min: 1 })
  page?: number;

  @Prop({ required: true })
  snippet!: string;
}

export const CitationSchema = SchemaFactory.createForClass(Citation);
