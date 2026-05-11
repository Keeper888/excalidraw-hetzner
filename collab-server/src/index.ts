import { createServer } from "node:http";
import { Server } from "socket.io";

const PORT = Number(process.env.PORT || 4180);
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:4243";

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, ts: Date.now() }));
});

const io = new Server(httpServer, {
  cors: {
    origin: CORS_ORIGIN.split(",").map((o) => o.trim()),
    methods: ["GET", "POST"],
  },
  transports: ["websocket", "polling"],
  maxHttpBufferSize: 10e6,
});

const followRooms = new Map<string, Set<string>>();

io.on("connection", (socket) => {
  io.to(socket.id).emit("init-room");

  socket.on("join-room", (roomId: string) => {
    socket.join(roomId);

    const clients = io.sockets.adapter.rooms.get(roomId);
    if (clients && clients.size <= 1) {
      io.to(socket.id).emit("first-in-room");
    } else {
      socket.broadcast.to(roomId).emit("new-user", socket.id);
    }

    if (clients) {
      io.in(roomId).emit("room-user-change", Array.from(clients));
    }
  });

  socket.on(
    "server-broadcast",
    (roomId: string, data: ArrayBuffer, iv: Uint8Array) => {
      socket.broadcast.to(roomId).emit("client-broadcast", data, iv);
    },
  );

  socket.on(
    "server-volatile-broadcast",
    (roomId: string, data: ArrayBuffer, iv: Uint8Array) => {
      socket.volatile.broadcast.to(roomId).emit("client-broadcast", data, iv);
    },
  );

  socket.on("user-follow", (payload: { leader: string; follower: string }) => {
    const roomId = `follow@${payload.leader}`;

    if (payload.follower) {
      socket.join(roomId);
    } else {
      socket.leave(roomId);
    }

    const clients = io.sockets.adapter.rooms.get(roomId);
    const followers = clients ? Array.from(clients) : [];
    followRooms.set(roomId, new Set(followers));

    io.in(roomId).emit("user-follow-room-change", followers);
  });

  socket.on("disconnecting", () => {
    for (const roomId of socket.rooms) {
      if (roomId === socket.id) continue;

      const clients = io.sockets.adapter.rooms.get(roomId);
      if (!clients) continue;

      const remaining = Array.from(clients).filter((id) => id !== socket.id);

      if (roomId.startsWith("follow@")) {
        if (remaining.length === 0) {
          followRooms.delete(roomId);
        } else {
          followRooms.set(roomId, new Set(remaining));
          io.in(roomId).emit("user-follow-room-change", remaining);
        }
      } else {
        io.in(roomId).emit("room-user-change", remaining);
      }
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`excalidraw collab server listening on :${PORT}`);
  console.log(`  CORS origin: ${CORS_ORIGIN}`);
});
