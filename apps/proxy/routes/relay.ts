import { defineWebSocketHandler } from "nitro/h3";

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

    // No room. The client reconnects with a workspace.
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
