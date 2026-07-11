const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json({limit: '50mb'}));
app.use(express.static('public'));

// حط بياناتك هنا من cloudinary
cloudinary.config({
  cloud_name: 'حط_الكلاود_نيم_هنا',
  api_key: 'حط_الايبي_كي_هنا',
  api_secret: 'حط_السيكرت_هنا'
});

// قاعدة بيانات بملف عشان ما تتمسح
let DB = {users: [], msgs: { 'العامة': [], 'اليمن': [], 'الجزائر': [], 'مصر': [] }};
if(fs.existsSync('db.json')) DB = JSON.parse(fs.readFileSync('db.json'));
function saveDB(){ fs.writeFileSync('db.json', JSON.stringify(DB)); }

const io = new Server(server, { cors: { origin: "*" } });

// المتجر
const shopItems = {
  'color_gold': {name: 'لون ذهبي', price: 500, color: '#FFD700'},
  'color_red': {name: 'لون احمر', price: 500, color: '#FF0000'},
  'color_blue': {name: 'لون ازرق', price: 500, color: '#2196F3'},
  'color_green': {name: 'لون اخضر', price: 500, color: '#4CAF50'},
  'vip': {name: 'تاج VIP', price: 2000, rank: 'vip'}
};

// التسجيل
app.post('/register', (req, res) => {
  let {name, pass} = req.body;
  if(DB.users.find(u => u.name == name)) return res.status(400).json({error:"الاسم موجود"});
  let user = {name, pass, rank:'member', coins:1000, color: '#FFFFFF'};
  DB.users.push(user);
  saveDB();
  res.json(user);
});

// الدخول
app.post('/login', (req, res) => {
  let user = DB.users.find(u => u.name == req.body.name && u.pass == req.body.pass);
  if (!user) return res.status(404).json({ error: "الاسم او كلمة السر خطأ" });
  res.json(user);
});

app.get('/users', (req, res) => { res.json(DB.users); });
app.get('/shop', (req, res) => { res.json(shopItems); });

// شراء من المتجر
app.post('/buy', (req, res) => {
  let {name, item} = req.body;
  let user = DB.users.find(u => u.name == name);
  let product = shopItems[item];
  if(!user ||!product) return res.status(400).json({error:"خطأ"});
  if(user.coins < product.price) return res.status(400).json({error:"الكوينز غير كافية"});

  user.coins -= product.price;
  if(product.color) user.color = product.color;
  if(product.rank) user.rank = product.rank;
  saveDB();
  res.json(user);
});

// رفع الصور
app.post('/upload', async (req, res) => {
  try{
    const fileStr = req.body.data;
    const result = await cloudinary.uploader.upload(fileStr, {folder: "yemen-chat"});
    res.json({ url: result.secure_url });
  }catch(e){
    res.status(500).json({error: e.message})
  }
});

io.on('connection', (socket) => {
  socket.on('join', (user) => {
    socket.user = user;
    if (!DB.users.find(u => u.name == user.name)) DB.users.push(user);
  });
  socket.on('joinRoom', (room) => { socket.join(room); });
  socket.on('sendMsg', (msg) => {
    if (!DB.msgs[msg.room]) DB.msgs[msg.room] = [];
    DB.msgs[msg.room].push(msg);
    if(DB.msgs[msg.room].length > 100) DB.msgs[msg.room].shift();
    io.to(msg.room).emit('newMsg', msg);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`السيرفر شغال`));