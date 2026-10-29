import { ModelDefinition } from '@nestjs/mongoose';
import { Attempt, AttemptSchema } from './attempt.schema';
import { ChatMessage, ChatMessageSchema } from './chat-message.schema';
import { Chunk, ChunkSchema } from './chunk.schema';
import { Citation, CitationSchema } from './citation.schema';
import { Cohort, CohortSchema } from './cohort.schema';
import { CohortMember, CohortMemberSchema } from './cohort-member.schema';
import { IngestionRun, IngestionRunSchema } from './ingestion-run.schema';
import { OtpCode, OtpCodeSchema } from './otp-code.schema';
import { PilotFeedback, PilotFeedbackSchema } from './pilot-feedback.schema';
import { Question, QuestionSchema } from './question.schema';
import { QuizSession, QuizSessionSchema } from './quiz-session.schema';
import { ReviewItem, ReviewItemSchema } from './review-item.schema';
import { SourceDocument, SourceDocumentSchema } from './source-document.schema';
import { Subject, SubjectSchema } from './subject.schema';
import { Topic, TopicSchema } from './topic.schema';
import { TopicMastery, TopicMasterySchema } from './topic-mastery.schema';
import { User, UserSchema } from './user.schema';
import { VideoResource, VideoResourceSchema } from './video-resource.schema';

/**
 * Every collection: the 17 from the ERD, plus otp_codes (email verification codes for auth).
 * Used by the app module and by scripts/db-setup.ts (which also creates the indexes).
 */
export const ALL_MODELS: ModelDefinition[] = [
  { name: OtpCode.name, schema: OtpCodeSchema },
  { name: User.name, schema: UserSchema },
  { name: Subject.name, schema: SubjectSchema },
  { name: Topic.name, schema: TopicSchema },
  { name: IngestionRun.name, schema: IngestionRunSchema },
  { name: SourceDocument.name, schema: SourceDocumentSchema },
  { name: Chunk.name, schema: ChunkSchema },
  { name: Citation.name, schema: CitationSchema },
  { name: Question.name, schema: QuestionSchema },
  { name: VideoResource.name, schema: VideoResourceSchema },
  { name: QuizSession.name, schema: QuizSessionSchema },
  { name: Attempt.name, schema: AttemptSchema },
  { name: TopicMastery.name, schema: TopicMasterySchema },
  { name: ReviewItem.name, schema: ReviewItemSchema },
  { name: ChatMessage.name, schema: ChatMessageSchema },
  { name: PilotFeedback.name, schema: PilotFeedbackSchema },
  { name: Cohort.name, schema: CohortSchema },
  { name: CohortMember.name, schema: CohortMemberSchema },
];
