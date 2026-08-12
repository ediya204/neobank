import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';

export function currentUserId(request: Request): string {
  const value = request.header('x-user-id');
  if (!value) throw new BadRequestException('x-user-id header is required');
  return value;
}
