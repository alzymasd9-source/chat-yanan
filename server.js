const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*", methods: ["GET", "POST"] } });
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const multer = require('multer');
const fs = require('fs');

if (!fs.existsSync('/tmp/uploads')) fs.mkdirSync('/tmp/uploads');

app.use(express.static('public'));
app.use(express.json());
app.use('/uploads', express.static('/tmp/uploads'));

const db = new sqlite3.Database('/tmp/chat.db');
db.serialize(()=>{
  db.run("CREATE TABLE IF NOT EXISTS members (id INTEGER PRIMARY KEY, name TEXT UNIQUE, password TEXT, gender TEXT, rank TEXT, avatar TEXT)");
  db.run("CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, room TEXT, from_name TEXT, content TEXT, type TEXT, time TEXT)");
  db.run("CREATE TABLE IF NOT EXISTS private_messages (id INTEGER PRIMARY KEY, room TEXT, from_name TEXT, to_name TEXT, content TEXT, type TEXT, filename TEXT, time TEXT)");
});

const storage = multer.diskStorage({
  destination: '/tmp/uploads/',
  filename: (req, file, cb) => cb(null, Date.now()+'-'+file.originalname)
});
const upload = multer({storage});

let onlineUsers = {};
let liveHost = null;

io.on('connection', (socket)=>{
  socket.on('register', async (data)=>{
    const hash = await bcrypt.hash(data.password, 10);
    db.run("INSERT INTO members (name,password,gender,rank) VALUES (?,?,?,'member')",[data.name,hash,data.gender],(err)=>{
      if(err) socket.emit('error_msg','الاسم موجود'); else socket.emit('register_ok');
    });
  });
  socket.on('login', (data)=>{
    db.get("SELECT * FROM members WHERE name=?",[data.name], async (err,row)=>{
      if(row && await bcrypt.compare(data.password,row.password)){
        onlineUsers[row.name]=socket.id; socket.name = row.name; socket.emit('login_ok',row);
      } else socket.emit('error_msg','خطا في الدخول');
    });
  });
  socket.on('guest', (data)=>{ onlineUsers[data.name]=socket.id; socket.name = data.name; socket.emit('login_ok',{name:data.name,rank:'guest'}); });
  socket.on('join', (data)=>{ socket.join(data.room); io.to(data.room).emit('users_list',Object.keys(onlineUsers).map(n=>({name:n,rank:'member'}))); });
  socket.on('chat_message', (data)=>{ const time = new Date().toLocaleTimeString('ar'); db.run("INSERT INTO messages (room,from_name,content,type,time) VALUES (?,?,?,?,?)",[data.room,socket.name,data.content,'text',time]); io.to(data.room).emit('chat_message',{from:socket.name,content:data.content,time:time}); });
  socket.on('open_private',(target)=>{ const room = [socket.name,target].sort().join('_'); socket.join(room); socket.emit('private_opened',{room:room}); db.all("SELECT * FROM private_messages WHERE room=?",[room],(err,rows)=>{ socket.emit('private_history',rows); });
  socket.on('private_message',(data)=>{ const time = new Date().toLocaleTimeString('ar'); db.run("INSERT INTO private_messages (room,from_name,to_name,content,type,time) VALUES (?,?,?,?,?,?)",[data.room,socket.name,data.receiver,data.content,data.msgType,time]); io.to(data.room).emit('private_message',{from:socket.name,content:data.content,type:data.msgType,time:time}); });
  socket.on('start_live',()=>{ liveHost=socket.name; io.emit('live_started',{host:liveHost}); });
  socket.on('join_live',()=>{ socket.join('live'); });
  socket.on('disconnect',()=>{ for(let n in onlineUsers){ if(onlineUsers[n]==socket.id) delete onlineUsers[n]; } });
});

app.post('/upload-private', upload.single('file'), (req,res)=>{
  const {room,sender,receiver} = req.body; const time = new Date().toLocaleTimeString('ar');
  const type = req.file.mimetype.startsWith('image')?'image':req.file.mimetype.startsWith('audio')?'audio':'file';
  db.run("INSERT INTO private_messages (room,from_name,to_name,content,type,filename,time) VALUES (?,?,?,?,?,?,?)",[room,sender,receiver,'/uploads/'+req.file.filename,type,req.file.originalname,time]);
  io.to(room).emit('private_message',{from:sender,content:'/uploads/'+req.file.filename,type:type,time:time,filename:req.file.originalname}); res.send('ok');
});

const PORT = process.env.PORT || 3000;
http.listen(PORT,()=>console.log('Server running on '+PORT));