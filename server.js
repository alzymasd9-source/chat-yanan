const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const Filter = require('bad-words');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

fs.mkdirSync('./uploads', { recursive: true });
fs.mkdirSync('./data', { recursive: true });

let db;
let users = {};
let liveStream = {active: false, host: null, viewers: []};
const filter = new Filter({ placeHolder: '*' });

const storage = multer.diskStorage({
  destination: './uploads/',
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({storage, limits:{fileSize: 20*1024*1024}});

app.post('/upload-private', upload.single('file'), async (req, res)=>{
  const {room, sender, receiver} = req.body;
  if(!req.file) return res.status(400).json({error:'لا يوجد ملف'});
  const url = '/uploads/' + req.file.filename;
  const time = getTime();
  const ext = path.extname(req.file.originalname).toLowerCase();
  let msgType = 'file';
  if(['.jpg','.jpeg','.png','.gif','.webp'].includes(ext)) msgType = 'image';
  if(['.mp3','.ogg','.wav','.webm'].includes(ext)) msgType = 'audio';
  if(['.mp4','.webm'].includes(ext)) msgType = 'video';
  const result = await db.run(`INSERT INTO private_messages (room, sender, receiver, content, time) VALUES (?,?,?,?,?)`, room, sender, receiver, url, time);
  const msg = {id: result.lastID, type: msgType, content: url, filename: req.file.originalname, from: sender, time: time};
  io.to(room).emit('private_message', msg);
  res.json({ok:true});
});

async function initDB(){
  db = await open({filename:'./data/chat.db', driver:sqlite3.Database});
  await db.exec(`CREATE TABLE IF NOT EXISTS members (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, password TEXT, gender TEXT, rank TEXT DEFAULT 'member', credits INTEGER DEFAULT 0, avatar TEXT DEFAULT '')`);
  await db.exec(`CREATE TABLE IF NOT EXISTS shortcuts (id INTEGER PRIMARY KEY, key TEXT UNIQUE, value TEXT)`);
  await db.exec(`CREATE TABLE IF NOT EXISTS private_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, room TEXT, sender TEXT, receiver TEXT, content TEXT, time TEXT)`);
  await db.exec(`CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, reporter TEXT, reported TEXT, room TEXT, msgId INTEGER, reason TEXT, content TEXT, time TEXT, status TEXT DEFAULT 'pending')`);
}
initDB();

function updateUserList(room){
  const roomUsers = Object.values(users).filter(x=>x.room===room);
  io.to(room).emit('users_list', roomUsers);
}

io.on('connection', socket=>{
  socket.on('join', async u=>{
    const user = await db.get("SELECT * FROM members WHERE name=?", u.name);
    users[socket.id] = {...u,...user, id:socket.id, room:u.room};
    socket.join(u.room);
    updateUserList(u.room);
  });

  socket.on('leave', room=>{
    socket.leave(room);
    if(users[socket.id]) users[socket.id].room = '';
    updateUserList(room);
  });

  socket.on('chat_message', async d=>{
    const me = users[socket.id]; if(!me) return;
    let content = d.content;
    const shortcuts = await db.all("SELECT * FROM shortcuts");
    shortcuts.forEach(s=> content = content.replace(new RegExp(`\\b${s.key}\\b`, 'g'), s.value));
    content = filter.clean(content);
    const time = getTime();
    io.to(d.room).emit('chat_message', {from: me.name, content: content, time: time});
  });

  socket.on('open_private', async (targetName)=>{
    const me = users[socket.id];
    const target = Object.values(users).find(u=>u.name===targetName);
    if(!target) return socket.emit('error','العضو غير متصل');
    const roomId = 'pm_' + [me.name, targetName].sort().join('_');
    socket.join(roomId);
    const oldMsgs = await db.all("SELECT * FROM private_messages WHERE room=? ORDER BY id ASC", roomId);
    socket.emit('private_history', oldMsgs);
    io.to(target.id).emit('private_invite', {from: me.name, room: roomId});
    io.to(target.id).emit('private_notification', {from: me.name});
    socket.emit('private_opened', {room: roomId, with: targetName});
  });

  socket.on('private_message', async d=>{
    const me = users[socket.id]; if(!me) return;
    let content = d.content; let type = d.msgType || 'text';
    if(type==='text'){
      const shortcuts = await db.all("SELECT * FROM shortcuts");
      shortcuts.forEach(s=> content = content.replace(new RegExp(`\\b${s.key}\\b`, 'g'), s.value));
      content = filter.clean(content);
    }
    const time = getTime();
    const [user1, user2] = d.room.replace('pm_','').split('_');
    const receiver = user1===me.name? user2 : user1;
    const result = await db.run(`INSERT INTO private_messages (room, sender, receiver, content, time) VALUES (?,?,?,?,?)`, d.room, me.name, receiver, content, time);
    const msg = {id: result.lastID, type: type, content: content, from: me.name, time: time};
    io.to(d.room).emit('private_message', msg);
    const receiverSocket = Object.keys(users).find(id => users[id].name === receiver);
    if(receiverSocket) io.to(receiverSocket).emit('private_notification', {from: me.name});
  });

  socket.on('delete_private_msg', async d=>{
    await db.run("DELETE FROM private_messages WHERE id=?", d.msgId);
    d.forEveryone? io.to(d.room).emit('delete_private_message', d.msgId) : socket.emit('delete_private_message', d.msgId);
  });

  socket.on('report_private_msg', async d=>{
    const me = users[socket.id]; if(!me) return;
    const msg = await db.get("SELECT * FROM private_messages WHERE id=?", d.msgId);
    if(!msg) return;
    await db.run(`INSERT INTO reports (reporter, reported, room, msgId, reason, content, time) VALUES (?,?,?,?,?,?,?)`, me.name, d.reported, d.room, d.msgId, d.reason, msg.content, getTime());
    const admins = Object.values(users).filter(u=>u.rank==='owner' || u.rank==='supervisor');
    admins.forEach(admin=> io.to(admin.id).emit('new_report', {reporter: me.name, reported: d.reported, reason: d.reason}));
    socket.emit('system', 'تم ارسال البلاغ للإدارة بنجاح');
  });

  socket.on('get_reports', async ()=>{
    const me = users[socket.id];
    if(me.rank!=='owner' && me.rank!=='supervisor') return;
    const reports = await db.all("SELECT * FROM reports WHERE status='pending' ORDER BY id DESC");
    socket.emit('reports_list', reports);
  });

  socket.on('close_report', async d=>{
    const me = users[socket.id];
    if(me.rank!=='owner' && me.rank!=='supervisor') return;
    await db.run("UPDATE reports SET status='closed' WHERE id=?", d.reportId);
    socket.emit('system', 'تم اغلاق البلاغ');
  });

  socket.on('start_live', async ()=>{
    const me = users[socket.id];
    if(me.rank!=='owner' && me.rank!=='supervisor') return socket.emit('error','ليس لديك صلاحية');
    liveStream.active = true; liveStream.host = me.name;
    io.emit('live_started', {host: me.name});
  });

  socket.on('stop_live', ()=>{
    const me = users[socket.id];
    if(liveStream.host!== me.name) return;
    liveStream.active = false; liveStream.host = null; liveStream.viewers = [];
    io.emit('live_stopped');
  });

  socket.on('join_live', ()=>{
    if(!liveStream.active) return socket.emit('error','لا يوجد بث الان');
    liveStream.viewers.push(socket.id);
    socket.emit('live_info', {host: liveStream.host, viewers: liveStream.viewers.length});
  });

  socket.on('register', async data=>{ await db.run("INSERT INTO members (name,password,gender) VALUES (?,?,?)", data.name,data.password,data.gender); socket.emit('register_ok'); });
  socket.on('login', async data=>{ const m = await db.get("SELECT * FROM members WHERE name=? AND password=?", data.name, data.password); m? socket.emit('login_ok', m) : socket.emit('error','خطأ'); });
  socket.on('disconnect', ()=>{ const user = users[socket.id]; if(user) updateUserList(user.room); delete users[socket.id]; });
});

function getTime(){const d=new Date(); return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`}
server.listen(process.env.PORT || 3000);