import { createSyncServer } from "./server.js";

const app = createSyncServer();

app.start().catch((err) => {
  console.error("[SyncServer] Startup failed:", err);
  process.exit(1);
});

const onShutdown = () => {
  console.log("[SyncServer] Shutting down...");
  app.stop().then(() => {
    process.exit(0);
  });
};

process.on("SIGINT", onShutdown);
process.on("SIGTERM", onShutdown);
