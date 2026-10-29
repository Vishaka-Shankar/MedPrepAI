import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export const VIDEO_STATUSES = ['active', 'hidden'] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

export type VideoResourceDocument = HydratedDocument<VideoResource>;

// ERD: VIDEO_RESOURCE (_id, topicId FK, youtubeId UK, title, status)
@Schema({ collection: 'video_resources', timestamps: true })
export class VideoResource {
  @Prop({ type: Types.ObjectId, ref: 'Topic', required: true, index: true })
  topicId!: Types.ObjectId;

  @Prop({ required: true, unique: true, trim: true })
  youtubeId!: string;

  @Prop({ required: true, trim: true })
  title!: string;

  @Prop({ type: String, required: true, enum: VIDEO_STATUSES, default: 'active' })
  status!: VideoStatus;
}

export const VideoResourceSchema = SchemaFactory.createForClass(VideoResource);
