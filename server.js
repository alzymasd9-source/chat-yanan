const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json({limit: '50mb'})); // زدنا الحجم عشان الصور
app.use(express.static('public'));

// حط بياناتك حق Cloudinary هنا
cloudinary.config({ 
  cloud_name: 'حط_الكلاود_نيم_هنا', 
  api_key: 'حط_الايبي_كي_هنا', 
  api_secret: 'حط_السيكرت_هنا' 
});

let users = [];
let msgs = { 'العامة': [], 'اليمن': [], 'الجزائر': [], 'مصر': [] };

const io = new Server(server, { cors: { origin: "*" } });

app.get('/msgs/:room', (req, res) => { res.json(msgs[req.params.room] || []); });
app.get('/users', (req, res) => { res.json(users); });

// رفع جديد على كلاوديناري
app.post('/upload', async (req, res) => {
  try{
    const fileStr = req.body.data; // بنرسل الصورة كـ base64
    const result = await cloudinary.uploader.upload(fileStr, {folder: "yemen-chat"});
    res.json({ url: result.secure_url });
  }catch(e){
    res.status(500).json({error: e.message})
  }
});

io.on('connection', (socket) => {
  socket.on('join', (user) => { socket.user = user; if (!users.find(u => u.name == user.name)) users.push(user); });
  socket.on('joinRoom', (room) => { socket.join(room); });
  socket.on('sendMsg', (msg) => { if (!msgs[msg.room]) msgs[msg.room] = []; msgs[msg.room].push(msg); io.to(msg.room).emit('newMsg', msg); });
  socket.on('disconnect', () => { users = users.filter(u => u.name!= socket.user?.name); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`السيرفر شغال`));