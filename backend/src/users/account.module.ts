import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { OtpModule } from '../auth/otp.module';
import { MailModule } from '../mail/mail.module';
import { ChatMessage, ChatMessageSchema } from '../schemas/chat-message.schema';
import { Citation, CitationSchema } from '../schemas/citation.schema';
import { AccountService } from './account.service';
import { UsersController } from './users.controller';
import { UsersModule } from './users.module';

/** The /users routes. Separate from UsersModule (database access only) so AuthModule can import that without a cycle. */
@Module({
  imports: [
    UsersModule,
    OtpModule,
    MailModule,
    AuthModule, // TokenService
    // Deleting an account also deletes the user's chat messages and their citations
    MongooseModule.forFeature([
      { name: ChatMessage.name, schema: ChatMessageSchema },
      { name: Citation.name, schema: CitationSchema },
    ]),
  ],
  controllers: [UsersController],
  providers: [AccountService],
})
export class AccountModule {}
