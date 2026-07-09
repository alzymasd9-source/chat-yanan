const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// رابط MongoDB Atlas المجاني - غيره
mongoose.connect('mongodb+srv://user:pass@cluster.mongodb.net/chatyemen');

// سكيمة المستخدم
const UserSchema = new mongoose.Schema({
  username: {type: String, unique: true},
  password: String, email: String,
  rank: {type: String, default: 'عضو'}, // زائر, عضو, مميز, مشرف, ادارة, ادمن, المالك
  gender: String, age: Number, coins: {type: Number, default: 0},
  color: {type: String, default: '#ffffff'}, fontSize: {type: Number, default: 14}
});
const User = mongoose.model('User', UserSchema);

// صلاحيات الرتب
const permissions = {
  'زائر': ['chat', 'pm', 'voice'],
  'عضو': ['chat', 'pm', 'voice', 'friend', 'like', 'report'],
  'مميز': ['upload', 'youtube', 'customColor', 'wall'],
  'مشرف': ['mute', 'kick', 'deleteMsg'],
  'ادارة': ['muteAdmin', 'changeName', 'news', 'logs', 'deleteAll'],
  'ادمن': ['viewIP', 'editProfile'],
  'المالك': ['all']
};
function can(rank, action){ return permissions[rank]?.includes(action) || rank === 'المالك' }

// تسجيل جديد
app.post('/register', async (req,res)=>{
  const {username,password,email,gender} = req.body;
  const hash = await bcrypt.hash(password, 10);
  const age = Math.floor(Math.random() * 80) + 20;
  const user = new User({username,password:hash,email,gender,age});
  await user.save();
  res.json(user);
});

// تسجيل دخول
app.post('/login', async (req,res)=>{
  const {username,password} = req.body;
  const user = await User.findOne({username});
  if(user && await bcrypt.compare(password, user.password)) res.json(user);
  else res.status(401).json({error:'خطأ'});
});

const onlineUsers = {};
const rooms = ['العامة', 'اليمن', 'مصر', 'الجزائر'];

io.on('connection', (socket) => {
  socket.on('joinRoom', (user, room) => {
    socket.user = user;
    socket.room = room;
    socket.join(room);
    onlineUsers[socket.id] = user;
    io.to(room).emit('userList', Object.values(onlineUsers).filter(u=>u.room==room));
    io.to(room).emit('system', `👋 ${user.username} دخل ${room}`);
  });

  socket.on('chatMessage', (msg) => {
    if(!can(socket.user.rank, 'chat')) return;
    socket.user.coins += 1; // زيادة الرصيد
    const data = {...msg, user: socket.user, time: new Date().toLocaleTimeString('ar-EG')};
    io.to(socket.room).emit('chatMessage', data);
  });

  socket.on('muteUser', (targetId, minutes) => {
    if(!can(socket.user.rank, 'mute')) return;
    io.to(targetId).emit('muted', minutes);
  });

  socket.on('report', (data)=>{
    // ترسل للإدارة فقط
    for(let s in onlineUsers){
      if(can(onlineUsers[s].rank, 'logs')){
        io.to(s).emit('newReport', data);
      }
    }
  })

  socket.on('disconnect', ()=>{
    if(socket.user?.rank === 'زائر') delete onlineUsers[socket.id]; // رصيد الزائر يروح
    io.emit('userList', Object.values(onlineUsers));
  });
});

server.listen(process.env.PORT || 3000);