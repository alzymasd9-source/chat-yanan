const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// سماح لكل الدومينات
app.use(cors());
app.use(express.json({limit: '10mb'}));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

let users = [];
let msgs = { 'العامة': [], 'اليمن': [], 'الجزائر': [], 'مصر': [] };
let news = [];
let logs = [];
let friendsWall = [];
let roomMods = {};

const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

const io = new Server(server, { cors: { origin: "*" } });

app.get('/ping', (req,res)=> res.json({ok:true})); // عشان نصحي السيرفر

app.post('/register', (req, res) => { let user = { ...req.body, id: Date.now() }; users.push(user); res.json(user); });
app.post('/login', (req, res) => { let user = users.find(u => u.name == req.body.name && u.pass == req.body.pass); if (!user) return res.status(404).json({ error: "خطأ" }); res.json(user); });
app.get('/msgs/:room', (req, res) => { res.json(msgs[req.params.room] || []); });
app.post('/upload', upload.single('file'), (req, res) => { res.json({ url: '/uploads/' + req.file.filename }); });
app.get('/users', (req, res) => { res.json(users); });
app.get('/news', (req, res) => { res.json(news); });
app.post('/news', (req, res) => { news.unshift(req.body); res.json({ ok: true }); });
app.get('/friends-wall', (req, res) => { res.json(friendsWall); });
app.post('/friends-wall', (req, res) => { friendsWall.unshift(req.body); res.json({ ok: true }); });
app.get('/logs', (req, res) => { res.json(logs); });
app.post('/logout', (req, res) => { users = users.filter(u => u.name != req.body.name); res.json({ ok: true }); });

io.on('connection', (socket) => {
  socket.on('join', (user) => { socket.user = user; if (!users.find(u => u.name == user.name)) users.push(user); io.emit('usersUpdate', users); });
  socket.on('joinRoom', (room) => { socket.join(room); });
  socket.on('sendMsg', (msg) => { if (!msgs[msg.room]) msgs[msg.room] = []; msgs[msg.room].push(msg); if (msgs[msg.room].length > 100) msgs[msg.room].shift(); io.to(msg.room).emit('newMsg', msg); });
  socket.on('system', (txt) => { io.emit('system', txt); });
  socket.on('pm', (data) => { io.emit('pm', data); });
  socket.on('like', (data) => { io.emit('like', data); let user = users.find(u => u.name == data.to); if (user) user.likes = (user.likes || 0) + 1; });
  socket.on('mute', (data) => { logs.push({ time: Date.now(), admin: socket.user?.name, action: 'كتم', target: data.name }); io.emit('mute', data); });
  socket.on('kick', (data) => { logs.push({ time: Date.now(), admin: socket.user?.name, action: 'طرد', target: data.name }); io.emit('system', `تم طرد ${data.name}`); });
  socket.on('autoMute', (data) => { logs.push({ time: Date.now(), admin: 'النظام', action: 'كتم تلقائي', target: data.name }); io.emit('mute', data); });
  socket.on('disconnect', () => { users = users.filter(u => u.name != socket.user?.name); io.emit('usersUpdate', users); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`السيرفر شغال على ${PORT}`));