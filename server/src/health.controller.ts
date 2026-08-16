import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  health() {
    return {
      status: 'ok',
      service: 'scc-digital-bank-core-api',
      timestamp: new Date().toISOString(),
    };
  }
}
