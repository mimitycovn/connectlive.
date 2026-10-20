const express = require("express");
const http = require("http");
const crypto = require("crypto");
const WebSocket = require("ws");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const rooms = new Map();

const makeToken = () => crypto.randomBytes(24).toString("hex");

app.post("/api/rooms", (req, res) => {
  const mode = req.body?.mode === "two-way" ? "two-way" : "one-way";
  const roomId = crypto.randomBytes(8).toString("hex");
  const hostToken = makeToken();

  rooms.set(roomId, {
    hostToken,
    mode,
    host: null,
    guest: null,
    createdAt: Date.now()
  });

  res.json({ roomId, hostToken, mode });
});

app.get("/api/rooms/:id", (req, res) => {
  const room = rooms.get(req.params.id);

  if (!room) {
    return res.status(404).json({
      error: "Session not found or expired."
    });
  }

  res.json({
    mode: room.mode,
    guestPresent: !!room.guest
  });
});

wss.on("connection", (ws) => {
  let roomId = null;
  let role = null;

  ws.on("message", (raw) => {
    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "join") {
      const room = rooms.get(msg.roomId);

      if (!room) {
        ws.send(JSON.stringify({
          type: "error",
          message: "This invitation is invalid or the session has ended."
        }));
        return;
      }

      if (msg.role === "host") {
        if (msg.hostToken !== room.hostToken) {
          ws.send(JSON.stringify({
            type: "error",
            message: "Host authorization failed."
          }));
          return;
        }

        room.host = ws;
        roomId = msg.roomId;
        role = "host";
      } else if (msg.role === "guest") {
        if (room.guest && room.guest.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: "error",
            message: "Someone is already in this session."
          }));
          return;
        }

        room.guest = ws;
        roomId = msg.roomId;
        role = "guest";
      }

      ws.send(JSON.stringify({
        type: "joined",
        role,
        mode: room.mode
      }));

      const peer = role === "host" ? room.guest : room.host;

      if (peer && peer.readyState === WebSocket.OPEN) {
        peer.send(JSON.stringify({ type: "peer-ready" }));
      }

      return;
    }

    if (!roomId || !role) return;

    const room = rooms.get(roomId);
    if (!room) return;

    const peer = role === "host" ? room.guest : room.host;

    if (msg.type === "end-session" && role === "host") {
      if (peer && peer.readyState === WebSocket.OPEN) {
        peer.send(JSON.stringify({ type: "session-ended" }));
      }

      rooms.delete(roomId);
      ws.send(JSON.stringify({ type: "session-ended" }));
      return;
    }

    if (
      peer &&
      peer.readyState === WebSocket.OPEN &&
      ["offer", "answer", "ice", "leave"].includes(msg.type)
    ) {
      peer.send(JSON.stringify({ ...msg, from: role }));
    }
  });

  ws.on("close", () => {
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    if (role === "host" && room.host === ws) {
      room.host = null;

      if (room.guest && room.guest.readyState === WebSocket.OPEN) {
        room.guest.send(JSON.stringify({ type: "peer-left" }));
      }
    }

    if (role === "guest" && room.guest === ws) {
      room.guest = null;

      if (room.host && room.host.readyState === WebSocket.OPEN) {
        room.host.send(JSON.stringify({ type: "peer-left" }));
      }
    }
  });
});

setInterval(() => {
  const cutoff = Date.now() - 12 * 60 * 60 * 1000;

  for (const [id, room] of rooms) {
    if (room.createdAt < cutoff) rooms.delete(id);
  }
}, 60 * 60 * 1000).unref();

const port = process.env.PORT || 3000;

server.listen(port, () => {
  console.log(`ConnectLive running on port ${port}`);
});
