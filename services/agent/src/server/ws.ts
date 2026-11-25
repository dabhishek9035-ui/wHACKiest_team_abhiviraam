/**
 * owner: M1 (Ronit Kapar)
 * purpose: Authenticated local WebSocket server (127.0.0.1:7777) implementing Section 7.1 JSON protocol and mounting M3 voice routes.
 */

import { createHash } from "node:crypto";
import http, { type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";
import {
  isSynthesizeUnsupported,
  type ClientMessage,
  type ServerEvent,
  type StoreApi,
  type VoiceService,
} from "@pengu/contracts";
import type { AgentRuntimeLoop } from "../runtime/loop.js";
import { extractTokenFromRequest, verifyWsAuthToken } from "./auth.js";

const WS_MAGIC_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export interface AgentWsServerOptions {
  host?: string;
  port?: number;
  authToken: string;
  runtime: AgentRuntimeLoop;
  store: StoreApi;
  voice?: VoiceService;
  isGmailConnected?: () => boolean;
  startGmailAuth?: () => boolean;
}

interface WsClient {
  socket: Duplex;
  buffer: Buffer;
}

function encodeTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  const len = payload.length;
  if (len < 126) {
    const header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + text opcode
    header[1] = len;
    return Buffer.concat([header, payload]);
  }
  if (len < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(len), 2);
  return Buffer.concat([header, payload]);
}

function encodeControlFrame(opcode: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(2);
  header[0] = 0x80 | (opcode & 0x0f);
  header[1] = payload.length;
  return Buffer.concat([header, payload]);
}

export class AgentWsServer {
  private readonly host: string;
  private readonly port: number;
  private readonly authToken: string;
  private readonly runtime: AgentRuntimeLoop;
  private readonly store: StoreApi;
  private readonly voice?: VoiceService;
  private readonly isGmailConnected: () => boolean;
  private readonly startGmailAuth?: () => boolean;
  private readonly server: Server;
  private readonly clients = new Set<WsClient>();

  constructor(options: AgentWsServerOptions) {
    // Bind exclusively to loopback 127.0.0.1 for local-only security.
    this.host = options.host ?? "127.0.0.1";
    this.port = options.port ?? 7777;
    this.authToken = options.authToken;
    this.runtime = options.runtime;
    this.store = options.store;
    this.voice = options.voice;
    this.isGmailConnected = options.isGmailConnected ?? (() => false);
    this.startGmailAuth = options.startGmailAuth;

    this.server = http.createServer((_req, res) => {
      res.writeHead(426, { "Content-Type": "text/plain" });
      res.end("Upgrade Required: connect via WebSocket.");
    });

    this.server.on("upgrade", (req, socket) => this.handleUpgrade(req, socket));
  }

  async start(): Promise<{ host: string; port: number }> {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.port, this.host, () => {
        this.server.off("error", reject);
        const addr = this.server.address();
        const actualPort =
          addr && typeof addr === "object" ? addr.port : this.port;
        resolve({ host: this.host, port: actualPort });
      });
    });
  }

  async stop(): Promise<void> {
    for (const client of this.clients) {
      try {
        client.socket.write(encodeControlFrame(0x8));
        client.socket.destroy();
      } catch {
        // ignore
      }
    }
    this.clients.clear();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  broadcast(event: ServerEvent): void {
    const frame = encodeTextFrame(JSON.stringify(event));
    for (const client of this.clients) {
      if (!client.socket.destroyed) {
        client.socket.write(frame);
      }
    }
  }

  private sendTo(client: WsClient, event: ServerEvent): void {
    if (!client.socket.destroyed) {
      client.socket.write(encodeTextFrame(JSON.stringify(event)));
    }
  }

  private handleUpgrade(req: IncomingMessage, socket: Duplex): void {
    const provided = extractTokenFromRequest(req);
    if (!verifyWsAuthToken(provided, this.authToken)) {
      socket.write(
        "HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
      );
      socket.destroy();
      return;
    }

    const key = req.headers["sec-websocket-key"];
    if (typeof key !== "string" || !key) {
      socket.write(
        "HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
      );
      socket.destroy();
      return;
    }

    const accept = createHash("sha1")
      .update(key + WS_MAGIC_GUID)
      .digest("base64");

    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "\r\n",
      ].join("\r\n")
    );

    const client: WsClient = { socket, buffer: Buffer.alloc(0) };
    this.clients.add(client);

    socket.on("data", (chunk: Buffer) => this.onData(client, chunk));
    socket.on("close", () => this.clients.delete(client));
    socket.on("error", () => this.clients.delete(client));
  }

  private onData(client: WsClient, chunk: Buffer): void {
    client.buffer = Buffer.concat([client.buffer, chunk]);
    while (client.buffer.length >= 2) {
      const first = client.buffer[0]!;
      const second = client.buffer[1]!;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let payloadLen = second & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (client.buffer.length < 4) return;
        payloadLen = client.buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (client.buffer.length < 10) return;
        payloadLen = Number(client.buffer.readBigUInt64BE(2));
        offset = 10;
      }

      const maskLen = masked ? 4 : 0;
      const frameLen = offset + maskLen + payloadLen;
      if (client.buffer.length < frameLen) return;

      const maskKey = masked
        ? client.buffer.subarray(offset, offset + 4)
        : null;
      const rawPayload = client.buffer.subarray(offset + maskLen, frameLen);
      client.buffer = client.buffer.subarray(frameLen);

      const payload = Buffer.alloc(payloadLen);
      if (maskKey) {
        for (let i = 0; i < payloadLen; i++) {
          payload[i] = rawPayload[i]! ^ maskKey[i % 4]!;
        }
      } else {
        rawPayload.copy(payload);
      }

      if (opcode === 0x8) {
        // Close frame
        client.socket.write(encodeControlFrame(0x8));
        client.socket.end();
        this.clients.delete(client);
        return;
      }
      if (opcode === 0x9) {
        // Ping -> Pong
        client.socket.write(encodeControlFrame(0xa, payload));
        continue;
      }
      if (opcode === 0x1) {
        const text = payload.toString("utf8");
        void this.dispatchMessage(client, text);
      }
    }
  }

  async dispatchMessage(client: WsClient, rawText: string): Promise<void> {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(rawText) as ClientMessage;
    } catch {
      this.sendTo(client, {
        type: "error",
        code: "INVALID_JSON",
        message: "WebSocket message must be valid JSON.",
      });
      return;
    }

    try {
      switch (msg.type) {
        case "user.message":
          await this.runtime.handleUserMessage({
            taskId: msg.taskId,
            text: msg.text,
            source: msg.source,
          });
          break;

        case "approval.decision":
          await this.runtime.handleApprovalDecision(
            msg.approvalId,
            msg.decision
          );
          break;

        case "task.list.request": {
          const tasks =
            msg.filter === "pending"
              ? await this.store.listPending()
              : await this.store.listTasks();
          this.sendTo(client, { type: "task.list", tasks });
          break;
        }

        case "task.resume":
          await this.runtime.handleTaskResume(msg.taskId);
          break;

        case "task.cancel":
          await this.runtime.handleTaskCancel(msg.taskId);
          break;

        case "gmail.auth.status.request":
          this.sendTo(client, {
            type: "gmail.auth.status",
            status: this.isGmailConnected() ? "connected" : "not_connected",
            message: this.isGmailConnected()
              ? "Gmail is connected."
              : "Connect a Gmail account to search and read mail.",
          });
          break;

        case "gmail.auth.start": {
          const started = this.startGmailAuth?.() ?? false;
          this.sendTo(client, {
            type: "gmail.auth.status",
            status: started ? "starting" : "failed",
            message: started
              ? "Google sign-in opened. Finish authorization in your browser."
              : "Could not start Google sign-in. Check the agent logs and try again.",
          });
          break;
        }

        case "voice.audio": {
          if (!this.voice) {
            this.sendTo(client, {
              type: "error",
              code: "VOICE_UNAVAILABLE",
              message: "Voice service is not mounted on the agent server.",
            });
            return;
          }
          this.broadcast({ type: "pet.state", state: "listening" });
          const transcript = await this.voice.transcribe({
            audio: msg.base64,
            mime: msg.mime,
            languageHint: msg.languageHint,
          });
          this.sendTo(client, {
            type: "voice.transcript",
            text: transcript.text,
            language: transcript.language,
          });
          this.broadcast({ type: "pet.state", state: "idle" });
          break;
        }

        case "tts.request": {
          if (!this.voice) {
            this.sendTo(client, {
              type: "tts.unsupported",
              reason: "Voice TTS service is not mounted.",
            });
            return;
          }
          const synth = await this.voice.synthesize({
            text: msg.text,
            language: msg.language,
          });
          if (isSynthesizeUnsupported(synth)) {
            this.sendTo(client, {
              type: "tts.unsupported",
              reason: synth.reason,
            });
          } else {
            this.sendTo(client, {
              type: "tts.audio",
              mime: synth.mime,
              base64: synth.audioBase64,
            });
          }
          break;
        }

        default:
          this.sendTo(client, {
            type: "error",
            code: "UNKNOWN_MESSAGE_TYPE",
            message: `Unsupported client message type.`,
          });
      }
    } catch (err) {
      this.sendTo(client, {
        type: "error",
        code: "INTERNAL_ERROR",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
