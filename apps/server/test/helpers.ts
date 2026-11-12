import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { io as ioc, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents, SessionSnapshot } from '@zirzircord/shared';
import { buildApp } from '../src/app';
import { ensureBucket } from '../src/lib/storage';

export type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export async function startServer() {
  await ensureBucket();
  const app = await buildApp({ logger: false });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  return { app, base };
}

export class Client {
  token = '';
  refreshToken = '';
  userId = '';
  publicId = '';
  socket?: TestSocket;
  events: Array<[string, any]> = [];

  constructor(
    private base: string,
    public deviceId = `dev-${randomUUID()}`,
  ) {}

  async req<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
    const res = await fetch(this.base + path, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as T };
  }

  async guest(name: string) {
    const r = await this.req('POST', '/auth/guest', { displayName: name, deviceId: this.deviceId });
    this.setAuth(r.body);
    return this;
  }

  async register(name: string) {
    const r = await this.req('POST', '/auth/register', {
      displayName: name,
      email: `${randomUUID()}@test.local`,
      password: 'password123',
      deviceId: this.deviceId,
    });
    this.setAuth(r.body);
    return this;
  }

  private setAuth(b: any) {
    if (!b?.accessToken) throw new Error('auth failed: ' + JSON.stringify(b));
    this.token = b.accessToken;
    this.refreshToken = b.refreshToken;
    this.userId = b.user.id;
    this.publicId = b.user.publicId;
  }

  async connect() {
    this.socket = ioc(this.base, { auth: { token: this.token }, transports: ['websocket'], forceNew: true });
    this.socket.onAny((ev, payload) => this.events.push([ev, payload]));
    await new Promise<void>((res, rej) => {
      this.socket!.once('connect', () => res());
      this.socket!.once('connect_error', rej);
    });
    return this;
  }

  enter(sessionId: string): Promise<SessionSnapshot> {
    return new Promise((res, rej) =>
      this.socket!.emit('session:enter', sessionId, (r) => (r.ok ? res(r.data) : rej(Object.assign(new Error(r.message), { code: r.error })))),
    );
  }

  exit(sessionId: string): Promise<void> {
    return new Promise((res, rej) => this.socket!.emit('session:exit', sessionId, (r) => (r.ok ? res() : rej(new Error(r.message)))));
  }

  waitFor<T = any>(event: string, pred: (p: any) => boolean = () => true, timeout = 5000): Promise<T> {
    const found = this.events.find(([e, p]) => e === event && pred(p));
    if (found) return Promise.resolve(found[1]);
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`timeout waiting for ${event}`)), timeout);
      const handler = (ev: string, p: any) => {
        if (ev === event && pred(p)) {
          clearTimeout(t);
          this.socket!.offAny(handler);
          res(p);
        }
      };
      this.socket!.onAny(handler);
    });
  }

  clearEvents() {
    this.events = [];
  }

  close() {
    this.socket?.disconnect();
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
