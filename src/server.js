const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const express = require("express");
const mammoth = require("mammoth");
const multer = require("multer");
const readXlsxFile = require("read-excel-file/node");
const XLSX = require("xlsx");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 25 * 1024 * 1024
});

const PORT = Number(process.env.PORT || 3000);
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 200);
const uploadsDir = path.join(__dirname, "..", "uploads");
const dataDir = path.join(__dirname, "..", "data");
const dbPath = path.join(dataDir, "local-talk.sqlite");
const GROUP_ID = "__local_group__";
const CUSTOM_GROUP_PREFIX = "group:";
const MESSAGE_RETENTION_DAYS = Number(process.env.MESSAGE_RETENTION_DAYS || 7);

if (process.env.TRUST_PROXY === "true") {
  app.set("trust proxy", true);
}

fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    ip TEXT PRIMARY KEY,
    nickname TEXT NOT NULL DEFAULT '',
    last_seen_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_by_ip TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS group_members (
    group_id TEXT NOT NULL,
    ip TEXT NOT NULL,
    PRIMARY KEY (group_id, ip),
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    from_ip TEXT NOT NULL,
    to_ip TEXT NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    quote_json TEXT,
    file_json TEXT,
    forwarded INTEGER NOT NULL DEFAULT 0,
    forwarded_from_ip TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_to_created ON messages(to_ip, created_at);
  CREATE INDEX IF NOT EXISTS idx_messages_pair_created ON messages(from_ip, to_ip, created_at);
`);

const usersByIp = new Map();
const socketsByIp = new Map();
const customGroups = new Map();

const insertUserStmt = db.prepare(`
  INSERT INTO users (ip, nickname, last_seen_at)
  VALUES (?, '', ?)
  ON CONFLICT(ip) DO UPDATE SET last_seen_at = excluded.last_seen_at
`);
const updateNicknameStmt = db.prepare("UPDATE users SET nickname = ?, last_seen_at = ? WHERE ip = ?");
const getUserStmt = db.prepare("SELECT ip, nickname, last_seen_at FROM users WHERE ip = ?");
const insertMessageStmt = db.prepare(`
  INSERT INTO messages (
    id, type, from_ip, to_ip, text, quote_json, file_json,
    forwarded, forwarded_from_ip, created_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const getGroupMessagesStmt = db.prepare(`
  SELECT * FROM messages
  WHERE to_ip = ? AND created_at >= ?
  ORDER BY created_at ASC
`);
const getPrivateMessagesStmt = db.prepare(`
  SELECT * FROM messages
  WHERE created_at >= ?
    AND ((from_ip = ? AND to_ip = ?) OR (from_ip = ? AND to_ip = ?))
  ORDER BY created_at ASC
`);
const insertGroupStmt = db.prepare(`
  INSERT INTO groups (id, name, created_by_ip, created_at)
  VALUES (?, ?, ?, ?)
`);
const insertGroupMemberStmt = db.prepare(`
  INSERT OR IGNORE INTO group_members (group_id, ip)
  VALUES (?, ?)
`);
const deleteOldMessagesStmt = db.prepare("DELETE FROM messages WHERE created_at < ?");

function normalizeUploadFilename(name) {
  const rawName = String(name || "file");
  const decoded = Buffer.from(rawName, "latin1").toString("utf8");
  if (decoded !== rawName && !decoded.includes("�") && /[\u4e00-\u9fff]/.test(decoded)) {
    return decoded;
  }
  return rawName;
}

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const originalName = normalizeUploadFilename(file.originalname);
    file.safeOriginalName = originalName;
    const ext = path.extname(originalName);
    const base = path.basename(originalName, ext);
    const safeBase = base
      .normalize("NFC")
      .replace(/[^\p{L}\p{N}._-]+/gu, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "file";
    cb(null, `${Date.now()}-${crypto.randomUUID()}-${safeBase}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_UPLOAD_MB * 1024 * 1024
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/uploads", express.static(uploadsDir, {
  setHeaders: (res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
  }
}));

function normalizeIp(ip) {
  if (!ip) return "unknown";
  return ip.replace(/^::ffff:/, "").replace(/^::1$/, "127.0.0.1");
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return normalizeIp(forwarded.split(",")[0].trim());
  }
  return normalizeIp(req.ip || req.socket.remoteAddress);
}

function userIdFromIp(ip) {
  return crypto.createHash("sha1").update(ip).digest("hex").slice(0, 12);
}

function ensureUser(ip) {
  const existing = usersByIp.get(ip);
  if (existing) return existing;

  const now = new Date().toISOString();
  insertUserStmt.run(ip, now);
  const stored = getUserStmt.get(ip);

  const user = {
    id: userIdFromIp(ip),
    ip,
    nickname: stored ? stored.nickname : "",
    connected: false,
    lastSeenAt: stored ? stored.last_seen_at : now
  };
  usersByIp.set(ip, user);
  return user;
}

function publicUser(user) {
  return {
    id: user.id,
    ip: user.ip,
    nickname: user.nickname,
    connected: user.connected,
    displayName: user.nickname || user.ip,
    lastSeenAt: user.lastSeenAt
  };
}

function onlineUsers() {
  return [...usersByIp.values()]
    .filter((user) => user.connected)
    .sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }))
    .map(publicUser);
}

function pairKey(a, b) {
  return [a, b].sort().join("::");
}

function isCustomGroupId(id) {
  return typeof id === "string" && id.startsWith(CUSTOM_GROUP_PREFIX);
}

function isGroupTarget(id) {
  return id === GROUP_ID || customGroups.has(id);
}

function isGroupMember(groupId, ip) {
  if (groupId === GROUP_ID) return true;
  const group = customGroups.get(groupId);
  return Boolean(group && group.members.includes(ip));
}

function publicGroup(group) {
  return {
    id: group.id,
    name: group.name,
    members: group.members,
    createdByIp: group.createdByIp,
    createdAt: group.createdAt
  };
}

function groupsForIp(ip) {
  return [...customGroups.values()]
    .filter((group) => group.members.includes(ip))
    .map(publicGroup);
}

function loadGroupsFromDb() {
  customGroups.clear();
  const rows = db.prepare(`
    SELECT g.id, g.name, g.created_by_ip, g.created_at, gm.ip AS member_ip
    FROM groups g
    LEFT JOIN group_members gm ON gm.group_id = g.id
    ORDER BY g.created_at ASC
  `).all();

  for (const row of rows) {
    if (!customGroups.has(row.id)) {
      customGroups.set(row.id, {
        id: row.id,
        name: row.name,
        members: [],
        createdByIp: row.created_by_ip,
        createdAt: row.created_at
      });
    }
    if (row.member_ip) {
      customGroups.get(row.id).members.push(row.member_ip);
    }
  }
}

function socketSetForIp(ip) {
  return socketsByIp.get(ip) || new Set();
}

function joinSocketsToRoom(ip, room) {
  for (const socketId of socketSetForIp(ip)) {
    const memberSocket = io.sockets.sockets.get(socketId);
    if (memberSocket) memberSocket.join(room);
  }
}

function emitGroupsToIp(ip) {
  for (const socketId of socketSetForIp(ip)) {
    const memberSocket = io.sockets.sockets.get(socketId);
    if (memberSocket) memberSocket.emit("groups:list", groupsForIp(ip));
  }
}

function emitGroupsToMembers(group) {
  for (const memberIp of group.members) {
    emitGroupsToIp(memberIp);
  }
}

function deliverMessage(message) {
  if (isGroupTarget(message.toIp)) {
    io.to(message.toIp).emit("message:new", message);
    return;
  }

  io.to(message.toIp).emit("message:new", message);
  io.to(message.fromIp).emit("message:new", message);
}

function addMessage(message) {
  insertMessageStmt.run(
    message.id,
    message.type,
    message.fromIp,
    message.toIp,
    message.text || "",
    message.quote ? JSON.stringify(message.quote) : null,
    message.file ? JSON.stringify(message.file) : null,
    message.forwarded ? 1 : 0,
    message.forwardedFromIp || null,
    message.createdAt
  );
}

function normalizeMessageFile(file) {
  if (!file || typeof file !== "object") return null;
  return {
    ...file,
    originalName: normalizeUploadFilename(file.originalName || "文件")
  };
}

function rowToMessage(row) {
  const file = row.file_json ? JSON.parse(row.file_json) : null;
  return {
    id: row.id,
    type: row.type,
    fromIp: row.from_ip,
    toIp: row.to_ip,
    text: row.text || "",
    quote: row.quote_json ? JSON.parse(row.quote_json) : null,
    file: normalizeMessageFile(file),
    forwarded: Boolean(row.forwarded),
    forwardedFromIp: row.forwarded_from_ip || null,
    createdAt: row.created_at
  };
}

function retentionCutoffIso() {
  return new Date(Date.now() - MESSAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function messagesForTarget(meIp, peerIp) {
  const cutoff = retentionCutoffIso();
  if (isGroupTarget(peerIp)) {
    return getGroupMessagesStmt.all(peerIp, cutoff).map(rowToMessage);
  }
  return getPrivateMessagesStmt.all(cutoff, meIp, peerIp, peerIp, meIp).map(rowToMessage);
}

function cleanupOldMessages() {
  deleteOldMessagesStmt.run(retentionCutoffIso());
}

function emitUsers() {
  io.emit("users:list", onlineUsers());
}

loadGroupsFromDb();
cleanupOldMessages();
setInterval(cleanupOldMessages, 60 * 60 * 1000).unref();

function messageSummary(message) {
  if (!message || typeof message !== "object") return null;

  const summary = {
    id: String(message.id || "").slice(0, 80),
    type: ["text", "file", "screenshot"].includes(message.type) ? message.type : "text",
    fromIp: normalizeIp(message.fromIp),
    text: String(message.text || "").slice(0, 300)
  };

  if (message.file && typeof message.file === "object") {
    summary.file = {
      originalName: normalizeUploadFilename(message.file.originalName || "文件").slice(0, 200),
      size: Number(message.file.size || 0),
      mimeType: String(message.file.mimeType || "").slice(0, 120),
      url: String(message.file.url || "").slice(0, 500)
    };
  }

  return summary;
}

function parseQuote(rawQuote) {
  if (!rawQuote) return null;
  if (typeof rawQuote === "string") {
    try {
      return messageSummary(JSON.parse(rawQuote));
    } catch {
      return null;
    }
  }
  return messageSummary(rawQuote);
}

app.get("/api/me", (req, res) => {
  const user = ensureUser(getClientIp(req));
  res.json(publicUser(user));
});

app.get("/api/messages/:peerIp", (req, res) => {
  const me = ensureUser(getClientIp(req));
  const peerIp = normalizeIp(req.params.peerIp);
  if (isCustomGroupId(peerIp)) {
    if (!customGroups.has(peerIp)) {
      res.status(404).json({ error: "group not found" });
      return;
    }
    if (!isGroupMember(peerIp, me.ip)) {
      res.status(403).json({ error: "not a group member" });
      return;
    }
  }
  res.json(messagesForTarget(me.ip, peerIp));
});

function uploadedFilePath(filename) {
  const safeName = path.basename(filename || "");
  const filePath = path.join(uploadsDir, safeName);
  if (!filePath.startsWith(uploadsDir + path.sep)) return null;
  return filePath;
}

function readExcelPreview(filePath) {
  const workbook = XLSX.readFile(filePath, {
    cellDates: true,
    sheetRows: 50
  });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  return XLSX.utils
    .sheet_to_json(workbook.Sheets[firstSheetName], {
      header: 1,
      raw: false,
      blankrows: false
    })
    .slice(0, 50)
    .map((row) => row.slice(0, 20));
}

app.get("/api/preview/:filename", async (req, res) => {
  const filename = path.basename(req.params.filename || "");
  const filePath = uploadedFilePath(filename);

  if (!filePath || !fs.existsSync(filePath)) {
    res.status(404).json({ error: "file not found" });
    return;
  }

  const ext = path.extname(filename).toLowerCase();

  try {
    if (ext === ".pdf") {
      res.json({
        kind: "pdf",
        name: filename,
        url: `/uploads/${encodeURIComponent(filename)}`
      });
      return;
    }

    if (ext === ".docx") {
      const result = await mammoth.extractRawText({ path: filePath });
      res.json({
        kind: "text",
        name: filename,
        text: result.value.slice(0, 100000),
        warnings: result.messages.map((message) => message.message)
      });
      return;
    }

    if (ext === ".xlsx") {
      let rows;
      try {
        rows = await readXlsxFile(filePath);
        rows = rows.slice(0, 50).map((row) => row.slice(0, 20));
      } catch (error) {
        rows = readExcelPreview(filePath);
      }
      res.json({
        kind: "spreadsheet",
        name: filename,
        rows
      });
      return;
    }

    if (ext === ".xls") {
      const rows = readExcelPreview(filePath);
      res.json({
        kind: "spreadsheet",
        name: filename,
        rows
      });
      return;
    }

    if ([".txt", ".md", ".csv", ".log"].includes(ext)) {
      const text = fs.readFileSync(filePath, "utf8").slice(0, 100000);
      res.json({ kind: "text", name: filename, text, warnings: [] });
      return;
    }

    res.status(415).json({ error: "preview not supported" });
  } catch (error) {
    res.status(500).json({ error: "preview failed" });
  }
});

app.post("/api/upload", upload.single("file"), (req, res) => {
  const me = ensureUser(getClientIp(req));
  const toIp = normalizeIp(req.body.toIp);

  if (!req.file || !toIp) {
    res.status(400).json({ error: "file and toIp are required" });
    return;
  }

  if (isCustomGroupId(toIp) && !isGroupMember(toIp, me.ip)) {
    res.status(403).json({ error: "not a group member" });
    return;
  }

  const message = {
    id: crypto.randomUUID(),
    type: req.body.kind === "screenshot" ? "screenshot" : "file",
    fromIp: me.ip,
    toIp,
    createdAt: new Date().toISOString(),
    quote: parseQuote(req.body.quote),
    file: {
      originalName: req.file.safeOriginalName || normalizeUploadFilename(req.file.originalname),
      size: req.file.size,
      mimeType: req.file.mimetype,
      url: `/uploads/${encodeURIComponent(req.file.filename)}`
    }
  };

  addMessage(message);
  deliverMessage(message);
  res.json(message);
});

io.on("connection", (socket) => {
  const ip = getClientIp(socket.request);
  const user = ensureUser(ip);
  user.connected = true;
  user.lastSeenAt = new Date().toISOString();
  updateNicknameStmt.run(user.nickname, user.lastSeenAt, ip);

  socket.join(ip);
  socket.join(GROUP_ID);
  for (const group of customGroups.values()) {
    if (group.members.includes(ip)) socket.join(group.id);
  }
  const currentSockets = socketsByIp.get(ip) || new Set();
  currentSockets.add(socket.id);
  socketsByIp.set(ip, currentSockets);

  socket.emit("me", publicUser(user));
  socket.emit("groups:list", groupsForIp(ip));
  emitUsers();

  socket.on("nickname:update", (nickname, ack) => {
    user.nickname = String(nickname || "").trim().slice(0, 32);
    user.lastSeenAt = new Date().toISOString();
    updateNicknameStmt.run(user.nickname, user.lastSeenAt, ip);
    socket.emit("me", publicUser(user));
    emitUsers();
    if (typeof ack === "function") ack(publicUser(user));
  });

  socket.on("group:create", (payload, ack) => {
    const requestedMembers = Array.isArray(payload && payload.members)
      ? payload.members.map(normalizeIp)
      : [];
    const name = String((payload && payload.name) || "").trim().slice(0, 40);
    const members = [...new Set([ip, ...requestedMembers])]
      .filter((memberIp) => usersByIp.has(memberIp));

    if (members.length < 2) {
      if (typeof ack === "function") ack({ ok: false, error: "至少选择 1 个成员" });
      return;
    }

    const group = {
      id: `${CUSTOM_GROUP_PREFIX}${crypto.randomUUID()}`,
      name: name || `群聊 ${members.length} 人`,
      members,
      createdByIp: ip,
      createdAt: new Date().toISOString()
    };
    insertGroupStmt.run(group.id, group.name, group.createdByIp, group.createdAt);
    for (const memberIp of group.members) {
      insertGroupMemberStmt.run(group.id, memberIp);
    }
    customGroups.set(group.id, group);

    for (const memberIp of group.members) {
      joinSocketsToRoom(memberIp, group.id);
    }
    emitGroupsToMembers(group);

    if (typeof ack === "function") ack({ ok: true, group: publicGroup(group) });
  });

  socket.on("message:send", (payload, ack) => {
    const toIp = normalizeIp(payload && payload.toIp);
    const text = String((payload && payload.text) || "").trim();

    if (!toIp || !text) {
      if (typeof ack === "function") ack({ ok: false, error: "toIp and text are required" });
      return;
    }

    if (isCustomGroupId(toIp) && !isGroupMember(toIp, ip)) {
      if (typeof ack === "function") ack({ ok: false, error: "not a group member" });
      return;
    }

    const message = {
      id: crypto.randomUUID(),
      type: "text",
      fromIp: ip,
      toIp,
      text: text.slice(0, 5000),
      quote: parseQuote(payload && payload.quote),
      createdAt: new Date().toISOString()
    };

    addMessage(message);
    deliverMessage(message);
    if (typeof ack === "function") ack({ ok: true, message });
  });

  socket.on("message:forward", (payload, ack) => {
    const toIp = normalizeIp(payload && payload.toIp);
    const source = messageSummary(payload && payload.message);

    if (!toIp || !source) {
      if (typeof ack === "function") ack({ ok: false, error: "toIp and message are required" });
      return;
    }

    if (isCustomGroupId(toIp) && !isGroupMember(toIp, ip)) {
      if (typeof ack === "function") ack({ ok: false, error: "not a group member" });
      return;
    }

    const message = {
      id: crypto.randomUUID(),
      type: source.type,
      fromIp: ip,
      toIp,
      text: source.text,
      file: source.file,
      forwarded: true,
      forwardedFromIp: source.fromIp,
      createdAt: new Date().toISOString()
    };

    if (message.type === "text" && !message.text) {
      if (typeof ack === "function") ack({ ok: false, error: "text is required" });
      return;
    }

    if (message.type !== "text" && !message.file) {
      if (typeof ack === "function") ack({ ok: false, error: "file is required" });
      return;
    }

    addMessage(message);
    deliverMessage(message);
    if (typeof ack === "function") ack({ ok: true, message });
  });

  socket.on("disconnect", () => {
    const socketSet = socketsByIp.get(ip);
    if (socketSet) {
      socketSet.delete(socket.id);
      if (socketSet.size === 0) {
        socketsByIp.delete(ip);
        user.connected = false;
        user.lastSeenAt = new Date().toISOString();
      }
    }
    emitUsers();
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Local Talk listening on http://0.0.0.0:${PORT}`);
});
