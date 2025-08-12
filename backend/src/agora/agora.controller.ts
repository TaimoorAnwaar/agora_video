import { Controller, Get, Query, Post, Body, BadRequestException, ForbiddenException } from '@nestjs/common';
import { AgoraService } from './agora.service';

@Controller('agora')
export class AgoraController {
  constructor(private readonly agora: AgoraService) {}

  @Post('create-room')
  createRoom(
    @Body()
    body: {
      // ISO string or epoch ms
      startTime?: string | number;
      // duration in minutes OR explicit endTime
      durationMinutes?: number;
      endTime?: string | number;
    },
  ) {
    const room = this.agora.createRoom();

    // If schedule provided, persist it
    const now = Date.now();
    let startTimeMs = now;
    let endTimeMs = now + 60 * 60 * 1000; // default 60 minutes

    if (body) {
      if (typeof body.startTime !== 'undefined') {
        startTimeMs = typeof body.startTime === 'string' ? Date.parse(body.startTime) : Number(body.startTime);
      }
      if (typeof body.endTime !== 'undefined') {
        endTimeMs = typeof body.endTime === 'string' ? Date.parse(body.endTime) : Number(body.endTime);
      } else if (typeof body.durationMinutes === 'number' && body.durationMinutes > 0) {
        endTimeMs = startTimeMs + body.durationMinutes * 60 * 1000;
      }
    }

    if (!Number.isFinite(startTimeMs) || !Number.isFinite(endTimeMs)) {
      throw new BadRequestException('Invalid startTime/endTime');
    }
    if (endTimeMs <= startTimeMs) {
      throw new BadRequestException('endTime must be after startTime');
    }

    this.agora.setRoomSchedule(String(room), startTimeMs, endTimeMs);

    return {
      room,
      link: `${process.env.FRONTEND_BASE_URL || 'http://localhost:3001'}/lobby/${room}`,
      startTimeMs,
      endTimeMs,
    };
  }

  @Get('token')
  getToken(@Query('channel') channel: string, @Query('uid') uid: string) {
    if (!channel || !uid) return { error: 'channel and uid required' };

    // Enforce time window if scheduled
    const schedule = this.agora.getRoomSchedule(String(channel));
    const now = Date.now();
    if (schedule) {
      const { startTimeMs, endTimeMs } = schedule;
      if (now < startTimeMs) {
        throw new ForbiddenException('meeting_not_started');
      }
      if (now > endTimeMs) {
        throw new ForbiddenException('meeting_ended');
      }
      // Token expiry at most until meeting end (plus small grace window 2 minutes)
      const expireSeconds = Math.max(60, Math.min(60 * 60 * 4, Math.floor((endTimeMs - now) / 1000) + 120));
      const token = this.agora.generateToken(channel, uid, 'publisher', expireSeconds);
      return { token, appId: process.env.AGORA_APP_ID, startTimeMs, endTimeMs };
    }

    // If no schedule, fallback to default 1 hour token
    const token = this.agora.generateToken(channel, uid, 'publisher', 60 * 60);
    return { token, appId: process.env.AGORA_APP_ID };
  }

  @Get('schedule')
  getSchedule(@Query('channel') channel: string) {
    if (!channel) throw new BadRequestException('channel required');
    const schedule = this.agora.getRoomSchedule(String(channel));
    if (!schedule) {
      return { startTimeMs: null, endTimeMs: null, now: Date.now() };
    }
    return { ...schedule, now: Date.now() };
  }
}