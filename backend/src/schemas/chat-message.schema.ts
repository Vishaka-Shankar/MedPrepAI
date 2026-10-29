import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export const INPUT_MODES = ['text', 'voice'] as const;
export type InputMode = (typeof INPUT_MODES)[number];

export const CHAT_STATUSES = ['pending', 'answered', 'failed'] as const;
export type ChatStatus = (typeof CHAT_STATUSES)[number];

export type ChatMessageDocument = HydratedDocument<ChatMessage>;

// ERD: CHAT_MESSAGE (_id, userId FK, question, inputMode, answer, status)
// + subjectId and outOfScope (not in the ERD): the chat page shows each question's subject filter
// and whether it was refused as out of scope, also in the history.
@Schema({ collection: 'chat_messages', timestamps: true })
export class ChatMessage {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 2000 })
  question!: string;

  // "voice" is FYP-II; FYP-I only uses "text"
  @Prop({ type: String, required: true, enum: INPUT_MODES, default: 'text' })
  inputMode!: InputMode;

  @Prop()
  answer?: string;

  // pending -> answered (incl. out of scope) or failed (Q&A service down / AI not configured)
  @Prop({ type: String, required: true, enum: CHAT_STATUSES, default: 'pending' })
  status!: ChatStatus;

  // The subject filter the question was asked with; null = all subjects
  @Prop({ type: Types.ObjectId, ref: 'Subject', default: null })
  subjectId?: Types.ObjectId | null;

  // true = nothing relevant in the syllabus material: answered with a refusal, no citations
  @Prop({ default: false })
  outOfScope!: boolean;
}

export const ChatMessageSchema = SchemaFactory.createForClass(ChatMessage);
// Chat history for a user, newest first
ChatMessageSchema.index({ userId: 1, createdAt: -1 });
