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

// هذا اهم سطر
app.use(express.static(path.join(__dirname, 'public')));

const DB_FILE = './data/chat.db';
const filter = new Filter({ placeHolder: '*' });
require('fs').mkdirSync('./data', { recursive: true });

let db;
let messageLimiter = new RateLimiterMemory({ points: 8, duration: 3 });
let users = {};

async function initDB() {
  db = await open({ filename: DB_FILE, driver: sqlite3.Database });
  await db.exec(`CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, room TEXT, type TEXT, content TEXT, user TEXT, time TEXT)`);
}
initDB();

io.on('connection', (socket) => {
  socket.on('join', async (u) => {
    const name = u.name ? filter.clean(u.name) : 'زائر';
    users[socket.id] = {name, id: socket.id, room: 'عام'};
    socket.join('عام');
    socket.emit('you are', {id: socket.id});
    socket.emit('users list', Object.values(users));
  });

  socket.on('message', async (d) => {
    const user = users[socket.id];
    if (!user || !d.content || d.content.trim() === '') return;
    const msg = {
      type: d.type, 
      content: filter.clean(d.content),
      user: {name: user.name, id: user.id},
      time: new Date().toLocaleTimeString('ar-EG', {hour: '2-digit', minute: '2-digit'})
    };
    io.to(user.room).emit('message', msg);
  });

  socket.on('disconnect', () => { delete users[socket.id]; });
});

app.get('/', (req,res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=>console.log(`شغال على ${PORT}`));