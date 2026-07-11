


const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" }, trustProxy: true });

app.use(cors());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');
const DATA_DIR = './data';
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const BANS_FILE = path.join(DATA_DIR, 'bans.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const MUTED_FILE = path.join(DATA_DIR, 'muted.json');
const MAX_MESSAGES = 100;

const loadJSON = (file, d = {}) => fs.existsSync(file)? JSON.parse(fs.readFileSync(file, 'utf8')) : d;
const saveJSON = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');

let bannedIPs = loadJSON(BANS_FILE);
let chatHistory = loadJSON(MESSAGES_FILE, { 'عام': [], 'تعارف': [], 'اليمن': [], 'فلة': [] });
let globalMuted = loadJSON(MUTED_FILE, []);

let users = {};
let rooms = { 'عام': [], 'تعارف': [], 'اليمن': [], 'فلة': [] };
const ADMINS = ['admin', 'مدير'];

const getIP = socket => socket.handshake.headers['x-forwarded-for']?.split(',')[0].trim() || socket.handshake.address;
const saveBans = () => saveJSON(BANS_FILE, bannedIPs);
const saveMuted = () => saveJSON(MUTED_FILE, globalMuted);
const saveMessage = (room, msg) => {
  chatHistory[room] = chatHistory[room] || [];
  chatHistory[room].push(msg);
  if (chatHistory[room].length > MAX_MESSAGES) chatHistory[room].shift();
  saveJSON(MESSAGES_FILE, chatHistory);
};

const imgStorage = multer.diskStorage({ destination: './uploads/', filename: (req, f, cb) => cb(null, 'img_' + Date.now() + path.extname(f.originalname)) });
const audioStorage = multer.diskStorage({ destination: './uploads/', filename: (req, f, cb) => cb(null, 'audio_' + Date.now() + '.webm') });
app.post('/upload', uploadImg = multer({ storage: imgStorage }).single('image'), (req, res) => res.json({ url: '/uploads/' + req.file.filename }));
app.post('/upload-audio', uploadAudio = multer({ storage: audioStorage }).single('audio'), (req, res) => res.json({ url: '/uploads/' + req.file.filename }));

io.on('connection', (socket) => {
  const ip = getIP(socket);
  if (bannedIPs[ip] && (bannedIPs[ip].expire === null || bannedIPs[ip].expire > Date.now())) {
    socket.emit('banned', `انت محظور: ${bannedIPs[ip].reason}`);
    return socket.disconnect(true);
  } else if (bannedIPs[ip]) { delete bannedIPs[ip]; saveBans(); }

  socket.on('join', (u) => {
    const isAdmin = ADMINS.includes(u.name.toLowerCase());
    users[socket.id] = {...u, id: socket.id, room: 'عام', isAdmin, ip};
    socket.join('عام'); rooms['عام'].push(socket.id);
    io.to('عام').emit('user joined', users[socket.id]);
    socket.emit('users list', rooms['عام'].map(id => users[id]));
    socket.emit('you are', {id: socket.id, isAdmin});
    socket.emit('chat history', chatHistory['عام'] || []);
    if (globalMuted.includes(socket.id)) socket.emit('you muted', true);
  });

  socket.on('joinRoom', (r) => {
    const user = users[socket.id]; if (!user) return;
    socket.leave(user.room); rooms[user.room] = rooms[user.room].filter(id => id!== socket.id);
    io.to(user.room).emit('user left', user.name);
    user.room = r; socket.join(r); rooms[r].push(socket.id);
    io.to(r).emit('user joined', user);
    socket.emit('users list', rooms[r].map(id => users[id]));
    socket.emit('chat history', chatHistory[r] || []);
  });

  socket.on('message', (d) => {
    const user = users[socket.id]; if (!user || globalMuted.includes(socket.id)) return;
    const msg = {id: Date.now(), type: d.type, content: d.content, user: {name: user.name, gender: user.gender, id: user.id}, time: new Date().toLocaleTimeString('ar-EG', {hour: '2-digit', minute: '2-digit'})};
    if (d.pm) {
      const t = io.sockets.sockets.get(d.pm);
      if (t) { t.emit('pm message', msg); socket.emit('pm message', msg); }
    } else { saveMessage(user.room, msg); io.to(user.room).emit('message', msg); }
  });

  socket.on('mute user', (id) => { if(users[socket.id]?.isAdmin &&!globalMuted.includes(id)){ globalMuted.push(id); saveMuted(); io.to(id).emit('you muted', true); io.to(users[socket.id].room).emit('system', `${users[id].name} تم كتمه`); } });
  socket.on('unmute user', (id) => { if(users[socket.id]?.isAdmin){ globalMuted = globalMuted.filter(x => x!== id); saveMuted(); io.to(id).emit('you muted', false); io.to(users[socket.id].room).emit('system', `${users[id].name} فك كتم`); } });
  socket.on('kick user', (id) => { if(users[socket.id]?.isAdmin){ io.to(id).emit('kicked', 'تم طردك'); io.sockets.sockets.get(id)?.disconnect(true); } });
  socket.on('ban user', (d) => {
    if(!users[socket.id]?.isAdmin) return;
    const t = users[d.targetId]; if(!t) return;
    bannedIPs[t.ip] = {reason: d.reason||'مخالفة', expire: d.hours? Date.now()+d.hours*3600000:null, by: users[socket.id].name};
    saveBans();
    io.to(d.targetId).emit('banned', `تم حظرك: ${bannedIPs[t.ip].reason}`);
    io.sockets.sockets.get(d.targetId)?.disconnect(true);
    io.to(users[socket.id].room).emit('system', `${t.name} تم حظره ${d.hours? d.hours+' ساعة':'دائم'}`);
  });
  socket.on('unban ip', (ip) => { if(users[socket.id]?.isAdmin){ delete bannedIPs[ip]; saveBans(); io.to(users[socket.id].room).emit('system', `فك حظر ${ip}`); } });
  socket.on('get bans', () => { if(users[socket.id]?.isAdmin) socket.emit('bans list', bannedIPs); });
  socket.on('save settings', (s) => { if(users[socket.id]){ users[socket.id].font=s.font; users[socket.id].color=s.color; } });
  socket.on('disconnect', () => { const u=users[socket.id]; if(u){ rooms[u.room]=rooms[u.room].filter(x=>x!==socket.id); io.to(u.room).emit('user left', u.name); delete users[socket.id]; } });
});

setInterval(()=>{ saveBans(); saveJSON(MESSAGES_FILE, chatHistory); saveMuted(); }, 30000);
server.listen(3000, ()=>console.log(`http://localhost:3000`));