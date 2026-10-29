import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/public.decorator';

@Controller()
export class AppController {
  /** GET /health - used to check the server is up. */
  @Public()
  @Get('health')
  health() {
    return { status: 'ok' };
  }
}
