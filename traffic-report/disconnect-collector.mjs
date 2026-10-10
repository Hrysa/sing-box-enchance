import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, extname } from "node:path";
import process from "node:process";

const websocketURL = process.env.CLASH_WS_URL ?? "ws://192.168.2.3:9090/connections/disconnect";
const apiSecret = process.env.CLASH_API_SECRET ?? "";
const logFile = process.env.LOG_FILE ?? "logs/disconnect.jsonl";
const reconnectInitialMs = positiveInteger("RECONNECT_INITIAL_MS", 1_000);
const reconnectMaxMs = positiveInteger("RECONNECT_MAX_MS", 30_000);

mkdirSync(dirname(logFile), { recursive: true });

let socket;
let reconnectTimer;
let reconnectAttempt = 0;
let shuttingDown = false;

let logStream;
let logDate;
let exitStatus = 0;
const openStreams = new Set();

function writeRecord(record, now) {
  const pad = (value) => String(value).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  if (date !== logDate) {
    logStream?.end();
    const extension = extname(logFile);
    const base = extension ? logFile.slice(0, -extension.length) : logFile;
    const path = `${base}-${date}${extension || ".jsonl"}`;
    logStream = createWriteStream(path, { flags: "a", encoding: "utf8" });
    openStreams.add(logStream);
    const currentStream = logStream;
    currentStream.on("error", (error) => {
      console.error(`[collector] cannot write ${path}:`, error);
      shutdown(1);
    });
    currentStream.on("close", () => {
      openStreams.delete(currentStream);
      if (shuttingDown && openStreams.size === 0) process.exit(exitStatus);
    });
    logDate = date;
    console.error(`[collector] writing ${path}`);
  }
  logStream.write(`${JSON.stringify(record)}\n`);
}

function positiveInteger(name, fallback) {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === "") {
    return fallback;
  }

  const value = Number.parseInt(rawValue, 10);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function connect() {
  if (shuttingDown) {
    return;
  }

  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) {
    return;
  }

  const connectionURL = authenticatedURL(websocketURL, apiSecret);

  console.error(`[collector] connecting to ${redactedURL(websocketURL)}`);

  try {
    socket = new WebSocket(connectionURL);
  } catch (error) {
    console.error("[collector] connection setup failed:", error);
    scheduleReconnect();
    return;
  }

  const currentSocket = socket;

  currentSocket.addEventListener("open", () => {
    reconnectAttempt = 0;
    console.error("[collector] connected");
  });

  currentSocket.addEventListener("message", (message) => {
    if (shuttingDown) return;
    try {
      const event = JSON.parse(String(message.data));
      const now = new Date();
      const record = event !== null && typeof event === "object" && !Array.isArray(event)
        ? { ...event, collectedAt: now.toISOString() }
        : { collectedAt: now.toISOString(), event };
      writeRecord(record, now);
    } catch (error) {
      console.error("[collector] ignored invalid JSON message:", error.message);
    }
  });

  currentSocket.addEventListener("error", (error) => {
    console.error("[collector] WebSocket error:", error.message ?? "connection failed");
    scheduleReconnect();
    if (socket === currentSocket) {
      socket = undefined;
    }
    try {
      currentSocket.close();
    } catch {
      // The close event will still trigger reconnect scheduling when possible.
    }
  });

  currentSocket.addEventListener("close", (event) => {
    if (socket === currentSocket) {
      socket = undefined;
    }
    console.error(`[collector] disconnected (${event.code}${event.reason ? `: ${event.reason}` : ""})`);
    scheduleReconnect();
  });
}

function scheduleReconnect() {
  if (shuttingDown || reconnectTimer !== undefined) {
    return;
  }

  const delay = Math.min(
    reconnectInitialMs * (2 ** reconnectAttempt),
    reconnectMaxMs,
  );
  reconnectAttempt += 1;
  console.error(`[collector] reconnecting in ${delay}ms`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    connect();
  }, delay);
}

function redactedURL(value) {
  try {
    const url = new URL(value);
    for (const key of ["token", "secret"]) {
      if (url.searchParams.has(key)) {
        url.searchParams.set(key, "REDACTED");
      }
    }
    return url.toString();
  } catch {
    return "<invalid URL>";
  }
}

function authenticatedURL(value, secret) {
  const url = new URL(value);
  if (secret !== "") {
    url.searchParams.set("token", secret);
  }
  return url.toString();
}

function shutdown(exitCode = 0) {
  exitStatus = Math.max(exitStatus, exitCode);
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  clearTimeout(reconnectTimer);
  try {
    socket?.close(1000, "collector shutting down");
  } catch {
    // The process can exit even if a connection is still being established.
  }
  if (openStreams.size === 0) {
    process.exit(exitStatus);
  } else {
    for (const stream of openStreams) stream.end();
  }
}

process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());

connect();
