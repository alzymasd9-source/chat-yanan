const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json({limit: '10mb'}));
app.use(express.static('public'));

// اهم سطرين عشان الرفع
const uploadPath = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath);
app.use('/uploads', express.static(uploadPath));

let users = [];
let msgs = { 'العامة': [], 'اليمن': [], 'الجزائر': [], 'مصر': [] };

const storage = multer.diskStorage({
  destination: uploadPath,
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

const io = new Server(server, { cors: { origin: "*" } });

app.post('/register', (req, res) => { let user = { ...req.body, id: Date.now() }; users.push(user); res.json(user); });
app.post('/login', (req, res) => { let user = users.find(u => u.name == req.body.name && u.pass == req.body.pass); if (!user) return res.status(404).json({ error: "خطأ" }); res.json(user); });
app.get('/msgs/:room', (req, res) => { res.json(msgs[req.params.room] || []); });
app.post('/upload', upload.single('file'), (req, res) => { res.json({ url: '/uploads/' + req.file.filename }); });
app.get('/users', (req, res) => { res.json(users); });
app.post('/logout', (req, res) => { users = users.filter(u => u.name != req.body.name); res.json({ ok: true }); });

io.on('connection', (socket) => {
  socket.on('join', (user) => { socket.user = user; if (!users.find(u => u.name == user.name)) users.push(user); });
  socket.on('joinRoom', (room) => { socket.join(room); });
  socket.on('sendMsg', (msg) => { if (!msgs[msg.room]) msgs[msg.room] = []; msgs[msg.room].push(msg); if (msgs[msg.room].length > 100) msgs[msg.room].shift(); io.to(msg.room).emit('newMsg', msg); });
  socket.on('disconnect', () => { users = users.filter(u => u.name != socket.user?.name); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`السيرفر شغال على ${PORT}`));