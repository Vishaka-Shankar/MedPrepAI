import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChatMessage, ChatMessageSchema } from '../schemas/chat-message.schema';
import { Chunk, ChunkSchema } from '../schemas/chunk.schema';
import { Citation, CitationSchema } from '../schemas/citation.schema';
import { SourceDocument, SourceDocumentSchema } from '../schemas/source-document.schema';
import { Subject, SubjectSchema } from '../schemas/subject.schema';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { RagClient } from './rag-client';

/** POST /chat/ask and GET /chat/history: NestJS stores the chat, the rag-service answers. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ChatMessage.name, schema: ChatMessageSchema },
      { name: Citation.name, schema: CitationSchema },
      { name: Subject.name, schema: SubjectSchema },
      { name: Chunk.name, schema: ChunkSchema },
      { name: SourceDocument.name, schema: SourceDocumentSchema },
    ]),
  ],
  controllers: [ChatController],
  providers: [ChatService, RagClient],
})
export class ChatModule {}
