#!/usr/bin/env node

const url =
  process.env.JETSTREAM_URL ??
  "wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=at.typbase.install";

const installs = new Set();
let socket;

function connect() {
  socket = new WebSocket(url);
  socket.addEventListener("open", () => {
    console.log(`watching ${url}`);
    console.log(`known installations: ${installs.size}`);
  });
  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (message.kind !== "commit") return;
    const did = message.did ?? message.commit?.repo;
    if (typeof did !== "string" || !did || installs.has(did)) return;
    installs.add(did);
    console.log(`${installs.size}\t${did}`);
  });
  socket.addEventListener("close", () => {
    console.error("Jetstream closed; reconnecting");
    setTimeout(connect, 2_000);
  });
  socket.addEventListener("error", (error) => {
    console.error("Jetstream error:", error.message ?? error);
    socket.close();
  });
}

process.on("SIGINT", () => {
  console.log(`\ninstallations seen this session: ${installs.size}`);
  socket?.close();
  process.exit(0);
});

connect();
