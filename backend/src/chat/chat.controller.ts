import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CurrentUser } from '../auth/current-user.decorator';
import { PublicUser } from '../users/users.service';
import { ChatMessageView, ChatService } from './chat.service';
import { AskDto } from './dto/ask.dto';

/** Chat with the syllabus. Both routes need a JWT (global JwtAuthGuard); each user sees only their own messages. */
@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  // Every question costs an LLM call: at most 10 a minute
  @Post('ask')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  ask(@CurrentUser() user: PublicUser, @Body() dto: AskDto): Promise<ChatMessageView> {
    return this.chat.ask(user.id, dto);
  }

  @Get('history')
  history(@CurrentUser() user: PublicUser): Promise<ChatMessageView[]> {
    return this.chat.history(user.id);
  }
}
