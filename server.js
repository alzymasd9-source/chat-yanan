const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const cors = require('cors');
const { RateLimiterMemory } = require('rate-limiter-flexible');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const Filter = require('bad-words');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DB_FILE = './data/chat.db';
const filter = new Filter({ placeHolder: '*' });
require('fs').mkdirSync('./data', { recursive: true });

let db;
let messageLimiter = new RateLimiterMemory({ points: 8, duration: 3 });
let users = {};

async function initDB() {
  db = await open({ filename: DB_FILE, driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, room TEXT, type TEXT, content TEXT, user TEXT, time TEXT, reactions TEXT, replyTo INTEGER);
    CREATE TABLE IF NOT EXISTS rooms (name TEXT PRIMARY KEY);
  `);
  const count = await db.get("SELECT COUNT(*) as c FROM rooms");
  if(count.c === 0) await db.run("INSERT INTO rooms (name) VALUES ('عام'),('تعارف'),('اليمن'),('فلة')");
}
initDB();

io.on('connection', async (socket) => {
  socket.on('join', async (u) => {
    const name = u.name ? filter.clean(u.name) : 'زائر'; // <-- حماية
    const isAdmin = name.toLowerCase() === 'admin';
    users[socket.id] = {...u, name, id: socket.id, room: 'عام', isAdmin};
    socket.join('عام');
    io.to('عام').emit('user joined', users[socket.id]);
    socket.emit('you are', {id: socket.id, isAdmin});
    socket.emit('users list', Object.values(users).filter(u => u.room === 'عام'));
    socket.emit('chat history', await db.all(`SELECT m.*, r.content as replyContent, r.user as replyUser FROM messages m LEFT JOIN messages r ON m.replyTo = r.id WHERE m.room = 'عام' ORDER BY m.id DESC LIMIT 100`));
  });

  socket.on('message', async (d) => {
    const user = users[socket.id];
    if (!user) return;
    
    // <-- هذا اهم تعديل: منع الرسائل الفاضية
    if(!d.content || d.content.trim() === '') return;

    try { await messageLimiter.consume(socket.id); } catch { return socket.emit('system', 'هدي شوي'); }

    let content = filter.clean(d.content); // الان امن 100%
    let mentionedUsers = [];

    if(d.mention){
      const mu = Object.values(users).find(u => u.name === d.mention && u.room === user.room);
      if(mu) {
        mentionedUsers.push(mu);
        content = `<b style="color:#075e54">${mu.name}</b> ` + content.replace(mu.name, '').trim();
      }
    }

    const msg = {
      type: d.type, content,
      user: JSON.stringify({name: user.name, gender: user.gender, id: user.id}),
      time: new Date().toLocaleTimeString('ar-EG', {hour: '2-digit', minute: '2-digit'}),
      reactions: JSON.stringify({}), replyTo: d.replyTo || null
    };

    const result = await db.run("INSERT INTO messages (room, type, content, user, time, reactions, replyTo) VALUES (?,?,?,?,?,?,?)",
      user.room, msg.type, msg.content, msg.user, msg.time, msg.reactions, msg.replyTo);
    const fullMsg = {...msg, id: result.lastID, user: JSON.parse(msg.user)};
    io.to(user.room).emit('message', fullMsg);
  });

  socket.on('disconnect', () => { 
    const u = users[socket.id]; 
    if(u){ 
      io.to(u.room).emit('user left', u.name); 
      delete users[socket.id]; 
    } 
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=>console.log(`شات اليمن المطور شغال على ${PORT}`));