import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { SUBJECT_KEYS, SubjectKey } from '../subjects';

/** POST /chat/ask. Same limits as the rag-service, so a question it would reject never gets there. */
export class AskDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'question must be text' })
  @MinLength(1, { message: 'Please type a question' })
  @MaxLength(1000, { message: 'question must be at most 1000 characters' })
  question!: string;

  // null or missing = all subjects
  @IsOptional()
  @IsIn(SUBJECT_KEYS, { message: `subjectId must be one of: ${SUBJECT_KEYS.join(', ')}` })
  subjectId?: SubjectKey | null;
}
