const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require("socket.io");
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors:{origin:"*"} });

app.use(express.json());
app.use(cors());

// انشاء مجلد uploads لو مش موجود
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
app.use('/uploads', express.static('uploads'));

// عشان يقرا ملفات الواجهة لو حطيتها في public
app.use(express.static(path.join(__dirname, 'public')));

// ربط مونغو
mongoose.connect(process.env.MONGO_URL || "mongodb://localhost:27017/yemenchat")
.then(()=> console.log("✅ متصل بقاعدة البيانات"))
.catch(err=> console.log("❌ خطأ المونغو:", err));

// الجداول
const User = mongoose.model("User", new mongoose.Schema({
  name:String, pass:String, rank:{type:String,default:"visitor"},
  coins:{type:Number,default:0}, gender:{type:String,default:""},
  avatar:{type:String,default:""}, wall:{type:String,default:""},
  pmSetting:{type:Number,default:1}, friends:{type:[String],default:[]},
  likes:{type:[String],default:[]}, theme:{type:String,default:"dark"},
  mutedUntil:{type:Date}, status:{type:String,default:""}, ip:{type:String,default:""}
}));
const Message = mongoose.model("Message", new mongoose.Schema({
  room:String, sender:String, senderRank:String, text:String,
  time:{type:Date,default:Date.now}
}));
const Log = mongoose.model("Log", new mongoose.Schema({
  admin:String,target:String,action:String,reason:String,time:{type:Date,default:Date.now}
}));
const Store = mongoose.model("Store", new mongoose.Schema({
  item:String,price:Number
}));
const News = mongoose.model("News", new mongoose.Schema({
  admin:String, text:String, time:{type:Date,default:Date.now}
}));

// رفع الصور
const upload = multer({dest:'uploads/'});
app.post('/upload', upload.single('file'), (req,res)=>{
  res.json({url:`/uploads/${req.file.filename}`});
});

// الصفحة الرئيسية - عشان ما يطلع Cannot GET /
app.get('/', (req,res)=>{
  res.send(`
    <!DOCTYPE html>
    <html dir="rtl" lang="ar">
    <head><meta charset="UTF-8"><title>YemenChat</title>
    <style>body{background:#111;color:#0f0;font-family:tahoma;text-align:center;padding:50px}</style>
    </head>
    <body>
      <h1>✅ سيرفر YemenChat شغال</h1>
      <p>المونغو متصل والـ API جاهز</p>
      <p>ارفع ملفات الواجهة في مجلد public عشان يشتغل الموقع</p>
    </body>
    </html>
  `)
})

// API
app.post('/login', async (req,res)=>{
  let user = await User.findOne({name:req.body.name});
  if(!user) user = await User.create(req.body);
  res.json(user);
});

app.post('/logout', async (req,res)=>{
  if(req.body.rank=='visitor') await User.deleteOne({name:req.body.name});
  res.json({ok:1});
});

app.post('/user/update', async (req,res)=>{
  await User.updateOne({name:req.body.name},{$set:{theme:req.body.theme}});
  res.json({ok:1});
});

app.get('/msgs/:room', async (req,res)=> res.json(await Message.find({room:req.params.room}).limit(100)));
app.get('/logs', async (req,res)=> res.json(await Log.find().sort({_id:-1}).limit(50)));
app.get('/store', async (req,res)=> res.json(await Store.find()));
app.get('/news', async (req,res)=> res.json(await News.find().sort({_id:-1}).limit(10)));
app.get('/user/:name', async (req,res)=> res.json(await User.findOne({name:req.params.name})));
app.get('/friends-wall/:me', async (req,res)=>{
  let me = await User.findOne({name:req.params.me});
  res.json(await Message.find({sender:{$in:me.friends}}).sort({_id:-1}).limit(20));
});
app.post('/store', async (req,res)=>{ await Store.updateOne({item:req.body.item},{$set:{price:req.body.price}},{upsert:true}); res.json({ok:1}) });
app.post('/friend/add', async (req,res)=>{ await User.updateOne({name:req.body.me},{$addToSet:{friends:req.body.target}}); res.json({ok:1}) });
app.post('/like', async (req,res)=>{ let u=await User.findOne({name:req.body.target}); if(u.likes.includes(req.body.me)) return res.json({msg:"لايك واحد فقط"}); await User.updateOne({name:req.body.target},{$addToSet:{likes:req.body.me}}); res.json({ok:1}) });
app.post('/news', async (req,res)=>{
  if(!['admin','owner'].includes(req.body.rank)) return res.status(403).send();
  await News.create({admin:req.body.admin, text:req.body.text});
  io.emit('newNews', req.body.text);
  res.json({ok:1});
});

// سوكت
io.on('connection', (socket)=>{
  socket.on('joinRoom', (room)=> socket.join(room));
  socket.on('sendMsg', async (data)=>{
    let msg = await Message.create(data);
    io.to(data.room).emit('newMsg', msg);
    await User.updateOne({name:data.sender},{$inc:{coins:1}});
  });
  socket.on('mute', async (data)=>{
    await User.updateOne({name:data.name},{$set:{mutedUntil:new Date(Date.now()+data.min*60000)}});
    await Log.create({admin:data.by,target:data.name,action:"كتم",reason:data.reason});
    io.emit('system', `[ تم كتم ${data.name} ${data.min} دقيقة ]`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT,()=>console.log("Server on "+PORT));