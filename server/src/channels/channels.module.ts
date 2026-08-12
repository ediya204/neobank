import { Module } from '@nestjs/common';
import { ChannelsController } from './channels.controller';

@Module({ controllers: [ChannelsController] })
export class ChannelsModule {}
