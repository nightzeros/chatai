/**
 * Minimal WebSocket surface used by the GPT-Live sideband channel.
 * Production uses the `ws` package; tests inject a fake.
 */

import WebSocket from "ws";

export type VoiceWebSocketMessageData = string | Buffer | ArrayBuffer | Buffer[];

export type VoiceWebSocket = {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  /** Transport-level liveness probe; optional so fakes may omit it. */
  ping?(): void;
  /** Drop the socket immediately without a close handshake. */
  terminate?(): void;
  on(event: "open", listener: () => void): void;
  on(event: "pong", listener: () => void): void;
  on(event: "message", listener: (data: VoiceWebSocketMessageData) => void): void;
  on(event: "close", listener: (code: number, reason: Buffer) => void): void;
  on(event: "error", listener: (err: Error) => void): void;
  once(event: "open", listener: () => void): void;
  once(event: "close", listener: (code: number, reason: Buffer) => void): void;
  removeAllListeners(): void;
};

export type VoiceWebSocketConnector = (
  url: string,
  headers: Record<string, string>,
) => VoiceWebSocket;

/** Default Node connector via `ws` (outbound sideband only — ChatAI does not terminate media). */
export function createWsConnector(): VoiceWebSocketConnector {
  return (url, headers) => new WebSocket(url, { headers }) as unknown as VoiceWebSocket;
}

export const WS_OPEN = 1;
