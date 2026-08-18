import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  health() {
    return {
      status: 'ok',
      service: 'ssc-digital-bank-core-api',
      timestamp: new Date().toISOString(),
    };
  }
}
