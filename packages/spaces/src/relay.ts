/**
 * Client for the app's relay: a per-workspace fanout channel for Loro
 * updates and awareness payloads. Bears no secrets and stores nothing: the
 * relay is a plain WebSocket, the room is the workspace id, and the server
 * never writes anything down. When it drops, the poll loop in TypbaseSync is
 * the fallback; presence is best-effort by design.
 */

export type RelayMessage =
  | { t: "join"; peer: string }
  | { t: "leave"; peer: string }
  | { t: "peers"; peers: string[] }
  | { t: "update"; peer: string; docId: string; update: string }
  | { t: "awareness"; peer: string; data: unknown };

export type RelayHandler = {
  onOpen?(): void;
  onClose?(): void;
  onUpdate?(docId: string, update: string): void;
  onAwareness?(peer: string, data: unknown): void;
  onPeers?(peers: string[]): void;
};

export class RelayClient {
  private ws: WebSocket | undefined;
  private peer = crypto.randomUUID();
  private retry = 0;
  private closed = false;
  private known = new Map<string, unknown>();

  constructor(
    private readonly url: string,
    private readonly room: string,
    private readonly handlers: RelayHandler = {},
  ) {}

  /** Snapshot of known remote peers (from awareness/join messages). */
  get peers(): Map<string, unknown> {
    return this.known;
  }

  connect(): void {
    if (this.closed || this.ws) return;

    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.retry = 0;
      this.send({ t: "join", peer: this.peer });
      this.handlers.onOpen?.();
    };
    ws.onclose = () => {
      this.ws = undefined;
      this.handlers.onClose?.();
      if (!this.closed) this.scheduleReconnect();
    };
    ws.onerror = () => {
      ws.close();
    };
    ws.onmessage = (event) => this.handle(event);
  }

  disconnect(): void {
    this.closed = true;
    this.ws?.close();
    this.ws = undefined;
  }

  sendUpdate(docId: string, update: Uint8Array): boolean {
    return this.send({
      t: "update",
      peer: this.peer,
      docId,
      update: b64(update),
    });
  }

  sendAwareness(data: unknown): boolean {
    return this.send({ t: "awareness", peer: this.peer, data });
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private scheduleReconnect(): void {
    const delay = Math.min(30_000, 500 * 2 ** this.retry++);
    setTimeout(() => this.connect(), delay);
  }

  private handle(event: MessageEvent): void {
    let message: RelayMessage;
    try {
      message = JSON.parse(String(event.data)) as RelayMessage;
    } catch {
      return;
    }

    if ("peer" in message && message.peer === this.peer) return;

    switch (message.t) {
      case "update":
        this.handlers.onUpdate?.(message.docId, message.update);
        break;
      case "awareness":
        this.known.set(message.peer, message.data);
        this.handlers.onAwareness?.(message.peer, message.data);
        break;
      case "join":
        if (!this.known.has(message.peer)) {
          this.known.set(message.peer, undefined);
          this.handlers.onPeers?.([...this.known.keys()]);
        }
        break;
      case "leave":
        this.known.delete(message.peer);
        this.handlers.onPeers?.([...this.known.keys()]);
        break;
      case "peers":
        for (const peer of message.peers) {
          if (!this.known.has(peer)) this.known.set(peer, undefined);
        }
        this.handlers.onPeers?.([...this.known.keys()]);
        break;
    }
  }

  private send(message: RelayMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;

    this.ws.send(JSON.stringify(message));

    return true;
  }
}

function b64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);

  return btoa(binary);
}
