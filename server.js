const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const { RateLimiterMemory } = require('rate-limiter-flexible');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const Filter = require('bad-words');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" }, maxHttpBufferSize: 10e6 });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

const UPLOAD_DIR = './uploads';
const DB_FILE = './data/chat.db';
const ADMINS = new Set(['admin']);
const filter = new Filter({ placeHolder: '*' });

require('fs').mkdirSync(UPLOAD_DIR, { recursive: true });
require('fs').mkdirSync('./data', { recursive: true });

let db;
let messageLimiter = new RateLimiterMemory({ points: 8, duration: 3 });
let users = {};
let globalMuted = new Set();

async function initDB() {
  db = await open({ filename: DB_FILE, driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT UNIQUE, pass TEXT, gender TEXT, isAdmin INTEGER);
    CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, room TEXT, type TEXT, content TEXT, user TEXT, time TEXT, reactions TEXT, replyTo INTEGER);
    CREATE TABLE IF NOT EXISTS bans (ip TEXT PRIMARY KEY, reason TEXT, expire INTEGER, by TEXT);
    CREATE TABLE IF NOT EXISTS muted (id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS rooms (name TEXT PRIMARY KEY, pass TEXT);
  `);
  const count = await db.get("SELECT COUNT(*) as c FROM rooms");
  if(count.c === 0) await db.run("INSERT INTO rooms (name) VALUES ('عام'),('تعارف'),('اليمن'),('فلة')");
}
initDB();

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, f, cb) => cb(null, `${Date.now()}${path.extname(f.originalname)}`)
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

app.post('/upload', upload.single('image'), (req, res) => res.json({ url: '/uploads/' + req.file.filename }));
app.post('/upload-audio', upload.single('audio'), (req, res) => res.json({ url: '/uploads/' + req.file.filename }));

io.on('connection', async (socket) => {
  globalMuted = new Set((await db.all("SELECT id FROM muted")).map(r => r.id));

  socket.on('join', async (u) => {
    const name = filter.clean(u.name);
    const isAdmin = ADMINS.has(name.toLowerCase());
    users[socket.id] = {...u, name, id: socket.id, room: 'عام', isAdmin};
    socket.join('عام');
    io.to('عام').emit('user joined', users[socket.id]);
    socket.emit('you are', {id: socket.id, isAdmin});
    socket.emit('users list', Object.values(users).filter(u => u.room === 'عام'));
    socket.emit('chat history', await db.all(`SELECT m.*, r.content as replyContent, r.user as replyUser FROM messages m LEFT JOIN messages r ON m.replyTo = r.id WHERE m.room = 'عام' ORDER BY m.id DESC LIMIT 100`));
    socket.emit('rooms list', await db.all("SELECT name FROM rooms"));
    if (globalMuted.has(socket.id)) socket.emit('you muted', true);
  });

  socket.on('createRoom', async (data) => {
    if(!users[socket.id]?.isAdmin) return;
    await db.run("INSERT OR IGNORE INTO rooms (name, pass) VALUES (?,?)", data.name, data.pass || null);
    io.emit('rooms list', await db.all("SELECT name FROM rooms"));
  });

  socket.on('joinRoom', async (r) => {
    const user = users[socket.id]; if (!user) return;
    socket.leave(user.room);
    io.to(user.room).emit('user left', user.name);
    user.room = r; socket.join(r);
    io.to(r).emit('user joined', user);
    socket.emit('users list', Object.values(users).filter(u => u.room === r));
    socket.emit('chat history', await db.all(`SELECT m.*, r.content as replyContent, r.user as replyUser FROM messages m LEFT JOIN messages r ON m.replyTo = r.id WHERE m.room =? ORDER BY m.id DESC LIMIT 100`, r));
  });

  socket.on('message', async (d) => {
    const user = users[socket.id];
    if (!user || globalMuted.has(socket.id)) return;
    try { await messageLimiter.consume(socket.id); } catch { return socket.emit('system', 'هدي شوي'); }

    let content = filter.clean(d.content);
    let mentionedUsers = [];

    if(d.mention){
      const mu = Object.values(users).find(u => u.name === d.mention && u.room === user.room);
      if(mu) {
        mentionedUsers.push(mu);
        content = `<b style="color:var(--green)">${mu.name}</b> ` + content.replace(mu.name, '').trim();
      }
    }

    const msg = {
      type: d.type, content,
      user: JSON.stringify({name: user.name, gender: user.gender, id: user.id}),
      time: new Date().toLocaleTimeString('ar-EG', {hour: '2-digit', minute: '2-digit'}),
      reactions: JSON.stringify({}), replyTo: d.replyTo || null
    };

    if (d.pm) {
      io.to(d.pm).emit('pm message', {...msg, user: JSON.parse(msg.user)});
      socket.emit('pm message', {...msg, user: JSON.parse(msg.user)});
    } else {
      const result = await db.run("INSERT INTO messages (room, type, content, user, time, reactions, replyTo) VALUES (?,?,?,?,?,?,?)",
        user.room, msg.type, msg.content, msg.user, msg.time, msg.reactions, msg.replyTo);
      const fullMsg = {...msg, id: result.lastID, user: JSON.parse(msg.user)};
      io.to(user.room).emit('message', fullMsg);
      mentionedUsers.forEach(u => {
        const s = Object.keys(users).find(k => users[k].id === u.id);
        if(s) io.to(s).emit('mention', {from: user.name, room: user.room, msg: content});
      })
    }
  });

  socket.on('react', async ({msgId, emoji}) => {
    const msg = await db.get("SELECT * FROM messages WHERE id =?", msgId);
    if(!msg) return;
    const reacts = JSON.parse(msg.reactions || '{}');
    reacts[emoji] = reacts[emoji] || [];
    if(!reacts[emoji].includes(socket.id)) reacts[emoji].push(socket.id);
    await db.run("UPDATE messages SET reactions =? WHERE id =?", JSON.stringify(reacts), msgId);
    io.to(users[socket.id].room).emit('reaction update', {msgId, reactions: reacts});
  });

  socket.on('delete message', async ({msgId}) => {
    const user = users[socket.id];
    const msg = await db.get("SELECT * FROM messages WHERE id =?", msgId);
    if(!msg) return;
    const msgUser = JSON.parse(msg.user);
    if(msgUser.id!== user.id &&!user.isAdmin) return;
    await db.run("DELETE FROM messages WHERE id =?", msgId);
    io.to(user.room).emit('message deleted', msgId);
  });

  socket.on('edit message', async ({msgId, newContent}) => {
    const user = users[socket.id];
    const msg = await db.get("SELECT * FROM messages WHERE id =?", msgId);
    if(!msg) return;
    const msgUser = JSON.parse(msg.user);
    if(msgUser.id!== user.id) return;
    newContent = filter.clean(newContent);
    await db.run("UPDATE messages SET content =? WHERE id =?", newContent, msgId);
    io.to(user.room).emit('message edited', {msgId, newContent});
  });

  socket.on('mute user', async (id) => { if(!users[socket.id]?.isAdmin) return; await db.run("INSERT OR IGNORE INTO muted (id) VALUES (?)", id); globalMuted.add(id); io.to(id).emit('you muted', true); });
  socket.on('unmute user', async (id) => { if(!users[socket.id]?.isAdmin) return; await db.run("DELETE FROM muted WHERE id =?", id); globalMuted.delete(id); io.to(id).emit('you muted', false); });
  socket.on('kick user', (id) => { if(!users[socket.id]?.isAdmin) return; io.to(id).emit('kicked', 'تم طردك'); io.sockets.sockets.get(id)?.disconnect(true); });
  socket.on('disconnect', () => { const u = users[socket.id]; if(u){ io.to(u.room).emit('user left', u.name); delete users[socket.id]; } });
});

server.listen(3000, ()=>console.log(`شات اليمن المطور شغال على http://localhost:3000`));