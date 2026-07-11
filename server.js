const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const Filter = require('bad-words');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
app.use(express.json());
app.use(express.static('public'));

let db;
let users = {};
let rooms = {
  'عام': {name:'🌎 غرفة العامة 🌎', welcome:'اهلا وسهلا {name} في العام'},
  'اليمن': {name:'🌎 غرفة اليمن 🌎', welcome:'حياك {name} في غرفة اليمن'},
  'الجزائر': {name:'🌎 غرفة الجزائر 🌎', welcome:'مرحبا {name}'},
  'مصر': {name:'🌎 غرفة مصر 🌎', welcome:'اهلا {name}'}
};

// اسعار المتجر
let storePrices = { vip: 5000, mod: 15000 };

const filter = new Filter({ placeHolder: '*' });
fs.mkdirSync('./data', { recursive: true });

async function initDB(){
  db = await open({filename:'./data/chat.db', driver:sqlite3.Database});
  await db.exec(`
    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE, password TEXT, gender TEXT,
      rank TEXT DEFAULT 'member', credits INTEGER DEFAULT 0,
      avatar TEXT DEFAULT '', wall TEXT DEFAULT '',
      status TEXT DEFAULT 'متصل', age INTEGER, country TEXT,
      private_setting TEXT DEFAULT 'all', join_date TEXT
    );
    CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, room TEXT, user TEXT, content TEXT, time TEXT);
  `);
}
initDB();

// نظام الصلاحيات
const permissions = {
  guest: {chat:true, voice:true, image:false, youtube:false, profile:false},
  member: {chat:true, voice:true, image:false, youtube:false, profile:false},
  vip: {chat:true, voice:true, image:true, youtube:true, profile:true, color:true},
  mod: {chat:true, voice:true, image:true, youtube:true, profile:true, kick:true, mute:true, delete:true},
  admin: {chat:true, voice:true, image:true, youtube:true, profile:true, kick:true, mute:true, delete:true, edit_name:true},
  owner: {all:true}
};

// نظام الرصيد التلقائي: +1 💵 كل 90 ثانية
setInterval(async () => {
  for(let id in users){
    const u = users[id];
    if(u && u.rank!== 'guest'){
      await db.run("UPDATE members SET credits = credits + 1 WHERE name =?", u.name);
      u.credits = (u.credits || 0) + 1;
      io.to(id).emit('credits_update', u.credits);
    }
  }
}, 90000);

io.on('connection', socket=>{
  console.log('مستخدم اتصل:', socket.id);

  socket.on('join', async u=>{
    const user = await db.get("SELECT * FROM members WHERE name=?", u.name);
    if(!user) return;
    users[socket.id] = {...u,...user, id:socket.id, room:u.room};
    socket.join(u.room);

    const welcome = rooms[u.room].welcome.replace('{name}', u.name);
    socket.emit('system', welcome);
    socket.emit('credits_update', user.credits || 0);

    io.to(u.room).emit('users list', Object.values(users).filter(x=>x.room===u.room));
  });

  socket.on('message', async d=>{
    const user = users[socket.id];
    if(!user || user.muted) return socket.emit('error','انت مكتوم');

    const perm = permissions[user.rank] || permissions.member;
    if(d.type==='image' &&!perm.image) return socket.emit('error','رتبة مميز مطلوبة');

    let content = filter.clean(d.content);
    const time = getTime();
    const msg = {id:Date.now(), content, user, time};

    await db.run("INSERT INTO messages (room,user,content,time) VALUES (?,?,?,?)",
      user.room, JSON.stringify(user), content, time);

    io.to(user.room).emit('message', msg);
  });

  // المتجر
  socket.on('buy_rank', async (rank)=>{
    const user = users[socket.id];
    const price = storePrices[rank];
    if(user.credits < price) return socket.emit('store_error', 'رصيدك غير كافي');

    await db.run("UPDATE members SET credits = credits -?, rank =? WHERE name =?",
      price, rank, user.name);

    user.credits -= price;
    user.rank = rank;

    socket.emit('buy_success', `تم شراء رتبة ${rank} بنجاح`);
    socket.emit('credits_update', user.credits);
    io.to(user.room).emit('system', `[ ${user.name} ترقى الى رتبة ${rank} ]`);
  });

  // تسجيل
  socket.on('register', async data=>{
    try{
      await db.run("INSERT INTO members (name,password,gender,join_date,credits) VALUES (?,?,?,?,0)",
        data.name,data.password,data.gender,new Date().toLocaleDateString());
      socket.emit('register_ok');
    }catch{e=>socket.emit('error','الاسم مستخدم')}
  });

  socket.on('login', async data=>{
    const m = await db.get("SELECT * FROM members WHERE name=? AND password=?", data.name, data.password);
    if(m) socket.emit('login_ok', m); else socket.emit('error','الاسم او كلمة السر خطأ');
  });

  socket.on('disconnect', ()=>{
    if(users[socket.id]?.rank === 'guest') users[socket.id].credits = 0;
    delete users[socket.id];
  });
});

function getTime(){const d=new Date(); return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')} ${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')}`}
server.listen(process.env.PORT || 3000);