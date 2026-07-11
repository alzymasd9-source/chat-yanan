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
let messageLimiter = new RateLimiterMemory({ points: 10, duration: 3 });
let users = {}; // نخزن المستخدمين: socket.id = {name, gender, room, type}

async function initDB() {
  db = await open({ filename: DB_FILE, driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY, 
      room TEXT, 
      type TEXT, 
      content TEXT, 
      user TEXT, 
      time TEXT
    );
    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY,
      name TEXT UNIQUE,
      password TEXT,
      gender TEXT,
      email TEXT,
      age INTEGER
    );
  `);
}
initDB();

// الصفحة الرئيسية
app.get('/', (req,res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on('connection', (socket) => {
  console.log('مستخدم جديد اتصل:', socket.id);

  // 1. دخول الغرفة - زائر او عضو او مسجل
  socket.on('join', async (u) => {
    const name = filter.clean(u.name || 'زائر');
    const room = u.room || 'عام';
    
    users[socket.id] = {
      name, 
      gender: u.gender || 'male', 
      type: u.type || 'guest',
      room: room,
      id: socket.id
    };
    
    socket.join(room);
    
    // نرسل للغرفة ان فلان انضم
    socket.to(room).emit('user joined', users[socket.id]);
    
    // نرسل قائمة المتصلين في الغرفة
    const roomUsers = Object.values(users).filter(x => x.room === room);
    io.to(room).emit('users list', roomUsers);
    
    console.log(`${name} دخل غرفة ${room}`);
  });

  // 2. ارسال رسالة
  socket.on('message', async (d) => {
    const user = users[socket.id];
    if (!user || !d.content || d.content.trim() === '') return;
    
    try { await messageLimiter.consume(socket.id); } 
    catch { return socket.emit('error', 'لا ترسل بسرعة'); }
    
    const content = filter.clean(d.content);
    const msg = {
      type: d.type,
      content,
      user: {name: user.name, gender: user.gender, id: user.id},
      time: new Date().toLocaleTimeString('ar-EG', {hour: '2-digit', minute: '2-digit'})
    };
    
    // حفظ في قاعدة البيانات
    await db.run(
      "INSERT INTO messages (room, type, content, user, time) VALUES (?,?,?,?,?)",
      user.room, msg.type, msg.content, JSON.stringify(msg.user), msg.time
    );
    
    // ارسال للغرفة فقط
    io.to(user.room).emit('message', msg);
  });

  // 3. تسجيل عضو جديد
  socket.on('register', async (data) => {
    try {
      await db.run(
        "INSERT INTO members (name, password, gender, email, age) VALUES (?,?,?,?,?)",
        data.name, data.password, data.gender, data.email, data.age
      );
      socket.emit('register_ok', 'تم انشاء الحساب');
    } catch(e) {
      socket.emit('register_error', 'الاسم مستخدم من قبل');
    }
  });

  // 4. تسجيل دخول عضو
  socket.on('login', async (data) => {
    const member = await db.get("SELECT * FROM members WHERE name = ? AND password = ?", data.name, data.password);
    if(member){
      socket.emit('login_ok', member);
    } else {
      socket.emit('login_error', 'الاسم او كلمة السر خطأ');
    }
  });

  // 5. الخروج
  socket.on('disconnect', () => { 
    const u = users[socket.id];
    if(u){
      socket.to(u.room).emit('user left', u.name);
      delete users[socket.id]; 
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=>console.log(`شات اليمن المطور شغال على ${PORT}`));