import { Injectable } from '@nestjs/common';
import { RtcTokenBuilder, RtcRole } from 'agora-access-token';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class AgoraService {
  private appId = process.env.AGORA_APP_ID || '';
  private appCertificate = process.env.AGORA_APP_CERTIFICATE || '';
  // Simple in-memory store. Replace with DB in production.
  private roomSchedules: Map<string, { startTimeMs: number; endTimeMs: number }> = new Map();

  generateToken(channelName: string, uid: string | number, role: 'publisher' | 'subscriber' = 'publisher', expireSeconds = 3600) {
    if (!this.appId || !this.appCertificate) {
      throw new Error('AGORA_APP_ID or AGORA_APP_CERTIFICATE is missing. Set them in backend/.env');
    }
    const roleEnum = role === 'publisher' ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;
    const ts = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = ts + expireSeconds;
    return RtcTokenBuilder.buildTokenWithUid(this.appId, this.appCertificate, channelName, Number(uid), roleEnum, privilegeExpiredTs);
  }

  createRoom() {
    // Generate a short id; you can store in DB if needed
    return uuidv4().split('-')[0];
  }

  setRoomSchedule(roomId: string, startTimeMs: number, endTimeMs: number) {
    this.roomSchedules.set(roomId, { startTimeMs, endTimeMs });
  }

  getRoomSchedule(roomId: string): { startTimeMs: number; endTimeMs: number } | undefined {
    return this.roomSchedules.get(roomId);
  }
}