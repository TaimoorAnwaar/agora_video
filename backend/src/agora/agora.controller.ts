import { Controller, Get, Query, Post, Body } from '@nestjs/common';
import { AgoraService } from './agora.service';

@Controller('agora')
export class AgoraController {
  constructor(private readonly agora: AgoraService) {}

  @Post('create-room')
  createRoom() {
    const room = this.agora.createRoom();
    return { room, link: `${process.env.FRONTEND_BASE_URL || 'http://localhost:3001'}/call/${room}` };
  }

  @Get('token')
  getToken(@Query('channel') channel: string, @Query('uid') uid: string) {
    if (!channel || !uid) return { error: 'channel and uid required' };
    const token = this.agora.generateToken(channel, uid, 'publisher', 60 * 60);
    return { token, appId: process.env.AGORA_APP_ID };
  }
}