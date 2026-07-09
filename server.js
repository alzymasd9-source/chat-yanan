const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios'); // جديد
const FormData = require('form-data'); // جديد
const fs = require('fs'); // جديد
const path = require('path');

const upload = multer({dest: 'uploads/'});

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads')); // عشان الصور المؤقتة

// ====== الاعدادات ======
mongoose.connect('mongodb+srv://yemenadmin:737946244@cluster0.ywgsrhl.mongodb.net/chatyemen?retryWrites=true&w=majority&appName=Cluster0')
.then(()=> console.log('✅ متصل بقاعدة البيانات'))
.catch(err=> console.log('❌ خطأ الاتصال:', err));

// حط مفتاح imgbb حقك هنا
const IMGBB_KEY = 'مفتاحك_هنا';

// ====== سكيمات قاعدة البيانات ======
const UserSchema = new mongoose.Schema({
  username: {type: String, unique: true},
  password: String, email: String,
  rank: {type: String, default: 'عضو'},
  gender: String, age: Number, coins: {type: Number, default: 0},
  color: {type: String, default: '#ffffff'}, fontSize: {type: Number, default: 14},
  privacy: {type: String, default: 'للجميع'}
});
const User = mongoose.model('User', UserSchema);

const ReportSchema = new mongoose.Schema({from: String, to: String, reason: String, msg: String, date: {type: Date, default: Date.now}});
const Report = mongoose.model('Report', ReportSchema);

const LogSchema = new mongoose.Schema({admin: String, target: String, action: String, reason: String, duration: Number, date: {type: Date, default: Date.now}});
const Log = mongoose.model('Log', LogSchema);

const FriendSchema = new mongoose.Schema({user1: String, user2: String, status: {type:String, default:'pending'}});
const Friend = mongoose.model('Friend', FriendSchema);

const WallSchema = new mongoose.Schema({owner: String, author: String, text: String, date: {type: Date, default: Date.now}});
const Wall = mongoose.model('Wall', WallSchema);

const PMSchema = new mongoose.Schema({from: String, to: String, text: String, date: {type: Date, default: Date.now}});
const PM = mongoose.model('PM', PMSchema);

// ====== الصلاحيات ======
const permissions = {
  'زائر': ['chat', 'pm', 'voice'],
  'عضو': ['chat', 'pm', 'voice', 'friend', 'like', 'report'],
  'مميز': ['upload', 'youtube', 'customColor', 'wall'],
  'مشرف': ['mute', 'kick', 'deleteMsg'],
  'ادارة': ['muteAdmin', 'changeName', 'news', 'logs', 'deleteAll', 'editProfile'],
  'ادمن': ['viewIP', 'editProfile'],
  'المالك': ['all']
};
function can(rank, action){
  const perms = permissions[rank] || [];
  return perms.includes(action) || rank === 'المالك'
}

const badWords = ['كلمة1','كلمة2','سب','شتم'];
function checkBadWords(text){ return badWords.some(word => text.includes(word)); }

// ====== API ======
app.post('/register', async (req,res)=>{
  const {username,password,email,gender} = req.body;
  const hash = await bcrypt.hash(password, 10);
  const age = Math.floor(Math.random() * 80) + 20;
  const user = new User({username,password:hash,email,gender,age});
  await user.save();
  res.json(user);
});

app.post('/login', async (req,res)=>{
  const {username,password} = req.body;
  const user = await User.findOne({username});
  if(user && await bcrypt.compare(password, user.password)) res.json(user);
  else res.status(401).json({error:'خطأ'});
});

app.post('/buyRank', async (req,res)=>{
  const {username, rank, price} = req.body;
  const user = await User.findOne({username});
  if(user.coins >= price){
    user.coins -= price; user.rank = rank; await user.save();
    res.json({success: true, user});
  } else res.json({success: false, msg: 'رصيدك لا يكفي'});
});

app.get('/admin/logs', async (req,res)=> res.json(await Log.find().sort({date:-1}).limit(100)));
app.get('/admin/reports', async (req,res)=> res.json(await Report.find().sort({date:-1})));

app.post('/admin/editUser', async (req,res)=>{
  const {admin, target, data} = req.body;
  const adminUser = await User.findOne({username: admin});
  if(!can(adminUser.rank, 'editProfile')) return res.status(403).send('ممنوع');
  await User.updateOne({username: target}, {$set: data});
  res.json({success: true});
});

app.post('/addFriend', async (req,res)=>{ await new Friend(req.body).save(); res.json({ok:true}); });
app.get('/friends/:user', async (req,res)=>{
  const friends = await Friend.find({$or:[{user1:req.params.user},{user2:req.params.user}], status:'accepted'});
  res.json(friends);
});
app.post('/wall/post', async (req,res)=>{ await new Wall(req.body).save(); res.json({ok:true}); });
app.get('/wall/:user', async (req,res)=>{ res.json(await Wall.find({owner:req.params.user}).sort({date:-1})); });
app.post('/pm/send', async (req,res)=>{ await new PM(req.body).save(); res.json({ok:true}); });
app.get('/pm/:u1/:u2', async (req,res)=>{ res.json(await PM.find({$or:[{from:req.params.u1,to:req.params.u2},{from:req.params.u2,to:req.params.u1}]}).sort({date:1})); });

// ====== رفع الصور على imgbb ======
app.post('/upload', upload.single('file'), async (req,res)=>{
  try {
    const form = new FormData();
    form.append('image', fs.createReadStream(req.file.path));

    const response = await axios.post(`https://api.imgbb.com/1/upload?key=${IMGBB_KEY}`, form, {
      headers: form.getHeaders()
    });

    fs.unlinkSync(req.file.path); // نمسح الملف المؤقت
    res.json({url: response.data.data.url});
  } catch (err) {
    console.log(err);
    res.status(500).json({error: 'فشل الرفع'});
  }
});

// ====== SOCKET ======
const onlineUsers = {};
const rooms = ['العامة', 'اليمن', 'مصر', 'الجزائر'];

io.on('connection', (socket) => {
  socket.on('joinRoom', (user, room) => {
    socket.user = user; socket.room = room; socket.join(room);
    onlineUsers[socket.id] = {...user, socketId: socket.id, room};
    io.to(room).emit('userList', Object.values(onlineUsers).filter(u=>u.room==room));
    io.to(room).emit('system', `👋 ${user.username} دخل ${room}`);
  });

  socket.on('chatMessage', async (msg) => {
    if(!can(socket.user.rank, 'chat')) return;
    if(checkBadWords(msg.text) && socket.user.rank!== 'المالك'){
      socket.emit('muted', 5);
      await new Log({admin: 'البوت الآلي', target: socket.user.username, action: 'كتم تلقائي', reason: msg.text}).save();
      io.to(socket.room).emit('system', `👾 البوت: تم كتم ${socket.user.username} 5 دقايق بسبب السب`);
      return;
    }
    await User.updateOne({username: socket.user.username}, {$inc: {coins: 1}});
    socket.user.coins += 1;
    const data = {...msg, user: socket.user, time: new Date().toLocaleTimeString('ar-EG'), id: Date.now()};
    io.to(socket.room).emit('chatMessage', data);
  });

  socket.on('muteUser', async (targetId, minutes) => {
    if(!can(socket.user.rank, 'mute')) return;
    await new Log({admin: socket.user.username, target: onlineUsers[targetId].username, action: 'كتم', duration: minutes}).save();
    io.to(targetId).emit('muted', minutes);
  });

  socket.on('kickUser', async (targetId, minutes) => {
    if(!can(socket.user.rank, 'kick')) return;
    await new Log({admin: socket.user.username, target: onlineUsers[targetId].username, action: 'طرد', duration: minutes}).save();
    io.to(targetId).emit('kicked', minutes);
  });

  socket.on('deleteMessage', (msgId) => {
    if(!can(socket.user.rank, 'deleteMsg')) return;
    io.to(socket.room).emit('deleteMsg', msgId);
  });

  socket.on('report', async (data)=>{
    await new Report(data).save();
    Object.keys(onlineUsers).forEach(id=>{
      if(can(onlineUsers[id].rank, 'logs')) io.to(id).emit('newReport', data);
    });
  });

  socket.on('pm', async (data)=>{
    const toUser = await User.findOne({username: data.to});
    const areFriends = await Friend.findOne({$or:[{user1:data.from,user2:data.to},{user1:data.to,user2:data.from}], status:'accepted'});
    if(toUser.privacy === 'للأصدقاء فقط' &&!areFriends && toUser.username!== data.from){
      socket.emit('system', 'هذا العضو يستقبل من الاصدقاء فقط');
      return;
    }
    Object.keys(onlineUsers).forEach(id=>{
      if(onlineUsers[id].username === data.to) io.to(id).emit('pm', data);
    });
  });

  socket.on('voiceOn', (username)=> io.to(socket.room).emit('voiceOn', username));

  socket.on('disconnect', ()=>{
    delete onlineUsers[socket.id];
    io.emit('userList', Object.values(onlineUsers));
  });
});

server.listen(process.env.PORT || 3000, ()=> console.log('الموقع شغال'));