import { defineWebSocketHandler } from "nitro/h3";

/**
 * Relay: per-workspace fanout, no data at rest. Peers connect to
 * `/relay?workspace=<id>`; each peer subscribes to a workspace-scoped topic,
 * so rooms stay isolated without a custom upgrade hook (the upgrade hook
 * stalls the handshake in this nightly, hence the topic approach).
 * Messages are opaque JSON (Loro updates, awareness payloads) forwarded
 * to everyone else in the room.
 *
 * PDS notifyWrite registration is deliberately not implemented here: the
 * sync engine polls listRepoOps, which is the correctness path. The relay
 * only makes it fast.
 */

function workspaceOf(request: Request): string {
  try {
    return new URL(request.url).searchParams.get("workspace") ?? "";
  } catch {
    return "";
  }
}

function topic(workspace: string): string {
  return `workspace:${workspace}`;
}

export default defineWebSocketHandler({
  open(peer) {
    const workspace = workspaceOf(peer.request);
    if (!workspace) return;

    // no room; the client reconnects with a workspace
    peer.subscribe(topic(workspace));
    peer.publish(topic(workspace), { t: "join", peer: peer.id });
  },

  message(peer, message) {
    const text = message.text();
    if (text.length > 512 * 1024) return;

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return;
    }

    if (data.t === "join" || data.t === "leave") return;

    const workspace = workspaceOf(peer.request);
    if (!workspace) return;

    peer.publish(topic(workspace), { ...data, peer: peer.id });
  },

  close(peer) {
    const workspace = workspaceOf(peer.request);
    if (!workspace) return;

    peer.publish(topic(workspace), { t: "leave", peer: peer.id });
  },
});
