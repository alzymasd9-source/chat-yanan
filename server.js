const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*", methods: ["GET", "POST"] } });
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const multer = require('multer');
const fs = require('fs');
const Filter = require('bad-words');

const filter = new Filter();

// ===== CONFIGURATION =====
const UPLOAD_DIR = '/tmp/uploads';
const DB_PATH = '/tmp/chat.db';

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ===== MIDDLEWARE =====
app.use(express.static('public'));
app.use(express.json());
app.use('/uploads', express.static(UPLOAD_DIR));

// ===== DATABASE SETUP =====
const db = new sqlite3.Database(DB_PATH);
db.serialize(() => {
  // Users/Members table with extended profile
  db.run(`CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    gender TEXT,
    rank TEXT DEFAULT 'guest',
    avatar TEXT,
    cover TEXT,
    bio TEXT,
    age INTEGER,
    country TEXT,
    status TEXT DEFAULT 'متصل',
    credits INTEGER DEFAULT 0,
    is_online BOOLEAN DEFAULT 0,
    last_seen TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Messages table (public room messages)
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY,
    room TEXT NOT NULL,
    from_id INTEGER NOT NULL,
    from_name TEXT NOT NULL,
    content TEXT NOT NULL,
    type TEXT DEFAULT 'text',
    media_url TEXT,
    time TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(from_id) REFERENCES members(id)
  )`);

  // Private messages
  db.run(`CREATE TABLE IF NOT EXISTS private_messages (
    id INTEGER PRIMARY KEY,
    room TEXT NOT NULL,
    from_id INTEGER NOT NULL,
    to_id INTEGER NOT NULL,
    from_name TEXT NOT NULL,
    to_name TEXT NOT NULL,
    content TEXT NOT NULL,
    type TEXT DEFAULT 'text',
    filename TEXT,
    time TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(from_id) REFERENCES members(id),
    FOREIGN KEY(to_id) REFERENCES members(id)
  )`);

  // Rooms
  db.run(`CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    cover TEXT,
    welcome_message TEXT,
    owner_id INTEGER,
    is_active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(owner_id) REFERENCES members(id)
  )`);

  // Room moderators
  db.run(`CREATE TABLE IF NOT EXISTS room_moderators (
    id INTEGER PRIMARY KEY,
    room_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(room_id) REFERENCES rooms(id),
    FOREIGN KEY(user_id) REFERENCES members(id)
  )`);

  // Rank definitions
  db.run(`CREATE TABLE IF NOT EXISTS ranks (
    id INTEGER PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    emoji TEXT,
    level INTEGER,
    permissions TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Moderation log
  db.run(`CREATE TABLE IF NOT EXISTS moderation_log (
    id INTEGER PRIMARY KEY,
    target_id INTEGER NOT NULL,
    moderator_id INTEGER NOT NULL,
    action TEXT,
    reason TEXT,
    duration INTEGER,
    room TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(target_id) REFERENCES members(id),
    FOREIGN KEY(moderator_id) REFERENCES members(id)
  )`);

  // Friends/Contacts
  db.run(`CREATE TABLE IF NOT EXISTS friends (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    friend_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES members(id),
    FOREIGN KEY(friend_id) REFERENCES members(id)
  )`);

  // Shop (store items)
  db.run(`CREATE TABLE IF NOT EXISTS shop_items (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    rank_type TEXT,
    price INTEGER,
    duration INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // User purchases
  db.run(`CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    price_paid INTEGER,
    expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES members(id),
    FOREIGN KEY(item_id) REFERENCES shop_items(id)
  )`);

  // News/Announcements
  db.run(`CREATE TABLE IF NOT EXISTS news (
    id INTEGER PRIMARY KEY,
    author_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(author_id) REFERENCES members(id)
  )`);

  // Initialize default ranks
  db.run("INSERT OR IGNORE INTO ranks (name, emoji, level, permissions) VALUES (?, ?, ?, ?)",
    ['guest', '🤖', 1, JSON.stringify(['chat', 'voice', 'private_message'])]);
  db.run("INSERT OR IGNORE INTO ranks (name, emoji, level, permissions) VALUES (?, ?, ?, ?)",
    ['member', '👤', 2, JSON.stringify(['chat', 'voice', 'private_message', 'add_friend'])]);
  db.run("INSERT OR IGNORE INTO ranks (name, emoji, level, permissions) VALUES (?, ?, ?, ?)",
    ['premium', '💎', 3, JSON.stringify(['chat', 'voice', 'image', 'youtube', 'profile_edit', 'custom_name_color'])]);
  db.run("INSERT OR IGNORE INTO ranks (name, emoji, level, permissions) VALUES (?, ?, ?, ?)",
    ['moderator', '🛡️', 4, JSON.stringify(['mute', 'kick', 'delete_message', 'manage_room'])]);
  db.run("INSERT OR IGNORE INTO ranks (name, emoji, level, permissions) VALUES (?, ?, ?, ?)",
    ['admin', '☆', 5, JSON.stringify(['mute', 'kick', 'delete_message', 'manage_room', 'edit_user_name', 'edit_user_profile', 'post_news'])]);
  db.run("INSERT OR IGNORE INTO ranks (name, emoji, level, permissions) VALUES (?, ?, ?, ?)",
    ['superadmin', '⭐', 6, JSON.stringify(['all', 'manage_moderators'])]);
  db.run("INSERT OR IGNORE INTO ranks (name, emoji, level, permissions) VALUES (?, ?, ?, ?)",
    ['owner', '👑', 7, JSON.stringify(['all', 'hide_identity', 'set_prices', 'manage_everything'])]);

  // Initialize default rooms
  db.run("INSERT OR IGNORE INTO rooms (name, description, welcome_message) VALUES (?, ?, ?)",
    ['main', 'الغرفة الرئيسية', 'أهلاً وسهلاً {name} في الغرفة الرئيسية 🎉']);
  db.run("INSERT OR IGNORE INTO rooms (name, description, welcome_message) VALUES (?, ?, ?)",
    ['yemen', 'غرفة اليمن', 'أهلاً {name} في غرفة اليمن 🇾🇪']);
  db.run("INSERT OR IGNORE INTO rooms (name, description, welcome_message) VALUES (?, ?, ?)",
    ['saudi', 'غرفة السعودية', 'أهلاً {name} في غرفة السعودية 🇸🇦']);
  db.run("INSERT OR IGNORE INTO rooms (name, description, welcome_message) VALUES (?, ?, ?)",
    ['egypt', 'غرفة مصر', 'أهلاً {name} في غرفة مصر 🇪🇬']);

  // Initialize admin user
  const adminPass = bcrypt.hashSync('1234', 10);
  db.run("INSERT OR IGNORE INTO members (name, password, gender, rank, age, country) VALUES (?, ?, ?, ?, ?, ?)",
    ['admin', adminPass, 'male', 'owner', 30, 'Yemen']);
});

// ===== MULTER CONFIGURATION =====
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// ===== HELPER FUNCTIONS =====
function getPermissions(rank) {
  return new Promise((resolve) => {
    db.get("SELECT permissions FROM ranks WHERE name = ?", [rank], (err, row) => {
      if (err || !row) return resolve([]);
      try {
        resolve(JSON.parse(row.permissions));
      } catch (e) {
        resolve([]);
      }
    });
  });
}

function hasPermission(permissions, action) {
  return permissions.includes('all') || permissions.includes(action);
}

let onlineUsers = {};
let mutedUsers = {};
let kickedUsers = {};

// ===== SOCKET.IO EVENTS =====
io.on('connection', (socket) => {

  // ===== AUTHENTICATION =====
  socket.on('register', async (data) => {
    const { name, password, gender } = data;
    if (!name || !password) return socket.emit('error_msg', 'بيانات غير كاملة');

    const hash = await bcrypt.hash(password, 10);
    db.run("INSERT INTO members (name, password, gender, rank) VALUES (?, ?, ?, ?)",
      [name, hash, gender || 'male', 'member'],
      (err) => {
        if (err) socket.emit('error_msg', 'الاسم موجود بالفعل');
        else socket.emit('register_ok', 'تم التسجيل بنجاح ✅');
      }
    );
  });

  socket.on('login', (data) => {
    const { name, password } = data;
    db.get("SELECT * FROM members WHERE name = ?", [name], async (err, row) => {
      if (!row) return socket.emit('error_msg', 'الاسم غير موجود');
      
      const match = await bcrypt.compare(password, row.password);
      if (match) {
        // Check if user is kicked
        if (kickedUsers[row.id]) {
          return socket.emit('error_msg', 'أنت مطرود من الموقع 🚫');
        }

        onlineUsers[row.name] = socket.id;
        socket.userId = row.id;
        socket.name = row.name;
        socket.rank = row.rank;
        socket.gender = row.gender;
        
        // Update user online status
        db.run("UPDATE members SET is_online = 1, last_seen = ? WHERE id = ?",
          [new Date().toISOString(), row.id]);

        socket.emit('login_ok', {
          id: row.id,
          name: row.name,
          rank: row.rank,
          gender: row.gender,
          avatar: row.avatar,
          credits: row.credits
        });
      } else {
        socket.emit('error_msg', 'كلمة السر خطأ ❌');
      }
    });
  });

  socket.on('guest', (data) => {
    const { name, gender } = data;
    if (!name) return socket.emit('error_msg', 'أدخل اسم');

    socket.userId = null;
    socket.name = name;
    socket.rank = 'guest';
    socket.gender = gender || 'male';
    onlineUsers[name] = socket.id;

    socket.emit('login_ok', {
      name: name,
      rank: 'guest',
      gender: gender || 'male'
    });
  });

  // ===== ROOM MANAGEMENT =====
  socket.on('join', (data) => {
    const { room } = data;
    socket.currentRoom = room;
    socket.join(room);

    // Send welcome message
    db.get("SELECT welcome_message FROM rooms WHERE name = ?", [room], (err, row) => {
      if (row) {
        const welcomeMsg = row.welcome_message.replace('{name}', socket.name);
        io.to(room).emit('system_message', {
          content: welcomeMsg,
          type: 'join'
        });
      }
    });

    sendOnlineUsers(room);
  });

  // ===== MESSAGES =====
  socket.on('chat_message', (data) => {
    const { room, content } = data;
    
    // Check if user is muted
    if (mutedUsers[socket.userId]) {
      const muteTime = mutedUsers[socket.userId];
      if (Date.now() < muteTime) {
        return socket.emit('error_msg', 'أنت مكتوم مؤقتاً 🔇');
      } else {
        delete mutedUsers[socket.userId];
      }
    }

    // Filter bad words
    const filteredContent = filter.clean(content);
    const time = new Date().toLocaleTimeString('ar');

    db.run("INSERT INTO messages (room, from_id, from_name, content, type, time) VALUES (?, ?, ?, ?, ?, ?)",
      [room, socket.userId || 0, socket.name, filteredContent, 'text', time],
      (err) => {
        if (!err) {
          io.to(room).emit('chat_message', {
            from: socket.name,
            content: filteredContent,
            time: time,
            rank: socket.rank
          });
        }
      }
    );
  });

  socket.on('open_private', (target) => {
    const room = [socket.name, target].sort().join('_');
    socket.join(room);
    socket.emit('private_opened', { room: room, with: target });

    db.all("SELECT * FROM private_messages WHERE room = ? ORDER BY created_at ASC",
      [room], (err, rows) => {
        socket.emit('private_history', rows || []);
      }
    );
  });

  socket.on('private_message', (data) => {
    const { room, receiver, content, msgType } = data;
    const time = new Date().toLocaleTimeString('ar');

    db.run("INSERT INTO private_messages (room, from_id, to_id, from_name, to_name, content, type, time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [room, socket.userId || 0, socket.userId || 0, socket.name, receiver, content, msgType, time],
      (err) => {
        if (!err) {
          io.to(room).emit('private_message', {
            from: socket.name,
            content: content,
            type: msgType,
            time: time
          });
        }
      }
    );
  });

  // ===== MODERATION =====
  socket.on('mute_user', async (data) => {
    const { targetName, duration, reason } = data;
    const perms = await getPermissions(socket.rank);

    if (!hasPermission(perms, 'mute')) {
      return socket.emit('error_msg', 'ليس لديك صلاحية كتم 🚫');
    }

    db.get("SELECT id FROM members WHERE name = ?", [targetName], (err, row) => {
      if (row) {
        const muteDuration = duration * 60 * 1000;
        mutedUsers[row.id] = Date.now() + muteDuration;

        // Log action
        db.run("INSERT INTO moderation_log (target_id, moderator_id, action, reason, duration, room) VALUES (?, ?, ?, ?, ?, ?)",
          [row.id, socket.userId, 'mute', reason, duration, socket.currentRoom]);

        io.to(socket.currentRoom).emit('system_message', {
          content: `${targetName} تم كتمه لمدة ${duration} دقيقة 🔇`,
          type: 'mute'
        });
      }
    });
  });

  socket.on('kick_user', async (data) => {
    const { targetName, duration, reason } = data;
    const perms = await getPermissions(socket.rank);

    if (!hasPermission(perms, 'kick')) {
      return socket.emit('error_msg', 'ليس لديك صلاحية طرد 🚫');
    }

    db.get("SELECT id FROM members WHERE name = ?", [targetName], (err, row) => {
      if (row) {
        const kickDuration = duration * 60 * 1000;
        kickedUsers[row.id] = Date.now() + kickDuration;

        // Disconnect user
        if (onlineUsers[targetName]) {
          io.to(onlineUsers[targetName]).emit('kicked', { reason: reason });
        }

        // Log action
        db.run("INSERT INTO moderation_log (target_id, moderator_id, action, reason, duration, room) VALUES (?, ?, ?, ?, ?, ?)",
          [row.id, socket.userId, 'kick', reason, duration, socket.currentRoom]);

        io.to(socket.currentRoom).emit('system_message', {
          content: `${targetName} تم طرده لمدة ${duration} دقيقة 👋`,
          type: 'kick'
        });
      }
    });
  });

  socket.on('delete_message', async (data) => {
    const { messageId } = data;
    const perms = await getPermissions(socket.rank);

    if (!hasPermission(perms, 'delete_message')) {
      return socket.emit('error_msg', 'ليس لديك صلاحية حذف الرسائل 🚫');
    }

    db.run("DELETE FROM messages WHERE id = ?", [messageId], (err) => {
      if (!err) {
        io.to(socket.currentRoom).emit('message_deleted', { messageId });
      }
    });
  });

  // ===== USER PROFILES =====
  socket.on('get_user_profile', (userName) => {
    db.get("SELECT * FROM members WHERE name = ?", [userName], (err, row) => {
      if (row) {
        socket.emit('user_profile', {
          id: row.id,
          name: row.name,
          avatar: row.avatar,
          cover: row.cover,
          bio: row.bio,
          age: row.age,
          country: row.country,
          rank: row.rank,
          credits: row.credits,
          status: row.status,
          is_online: row.is_online
        });
      }
    });
  });

  socket.on('update_profile', async (data) => {
    const { bio, status, age, country } = data;
    const perms = await getPermissions(socket.rank);

    if (!socket.userId) return socket.emit('error_msg', 'يجب تسجيل الدخول');

    const updateFields = [];
    const updateValues = [];

    if (bio) { updateFields.push('bio = ?'); updateValues.push(bio); }
    if (status) { updateFields.push('status = ?'); updateValues.push(status); }
    if (age && hasPermission(perms, 'profile_edit')) { updateFields.push('age = ?'); updateValues.push(age); }
    if (country && hasPermission(perms, 'profile_edit')) { updateFields.push('country = ?'); updateValues.push(country); }

    if (updateFields.length === 0) return;

    updateValues.push(socket.userId);
    const query = `UPDATE members SET ${updateFields.join(', ')} WHERE id = ?`;

    db.run(query, updateValues, (err) => {
      if (!err) {
        socket.emit('profile_updated', 'تم تحديث الملف الشخصي ✅');
      }
    });
  });

  // ===== FRIENDS =====
  socket.on('add_friend', (friendName) => {
    db.get("SELECT id FROM members WHERE name = ?", [friendName], (err, friendRow) => {
      if (friendRow) {
        db.run("INSERT OR IGNORE INTO friends (user_id, friend_id, status) VALUES (?, ?, ?)",
          [socket.userId, friendRow.id, 'pending'],
          (err) => {
            if (!err) {
              socket.emit('friend_request_sent', friendName);
            }
          }
        );
      }
    });
  });

  socket.on('accept_friend', (friendName) => {
    db.get("SELECT id FROM members WHERE name = ?", [friendName], (err, friendRow) => {
      if (friendRow) {
        db.run("UPDATE friends SET status = ? WHERE user_id = ? AND friend_id = ?",
          ['accepted', friendRow.id, socket.userId],
          (err) => {
            if (!err) {
              socket.emit('friend_added', friendName);
            }
          }
        );
      }
    });
  });

  // ===== LIKES =====
  socket.on('like_user', (targetName) => {
    db.get("SELECT id FROM members WHERE name = ?", [targetName], (err, row) => {
      if (row) {
        db.run("UPDATE members SET credits = credits + 1 WHERE id = ?", [row.id]);
        socket.emit('liked', targetName);
      }
    });
  });

  // ===== ADMIN FEATURES =====
  socket.on('get_moderation_log', async (data) => {
    const perms = await getPermissions(socket.rank);

    if (!hasPermission(perms, 'manage_room')) {
      return socket.emit('error_msg', 'ليس لديك صلاحية 🚫');
    }

    db.all("SELECT ml.*, m.name as moderator_name, t.name as target_name FROM moderation_log ml JOIN members m ON ml.moderator_id = m.id JOIN members t ON ml.target_id = t.id ORDER BY ml.created_at DESC LIMIT 50",
      (err, rows) => {
        socket.emit('moderation_log', rows || []);
      }
    );
  });

  socket.on('post_news', async (data) => {
    const { title, content } = data;
    const perms = await getPermissions(socket.rank);

    if (!hasPermission(perms, 'post_news')) {
      return socket.emit('error_msg', 'ليس لديك صلاحية نشر أخبار 🚫');
    }

    db.run("INSERT INTO news (author_id, title, content) VALUES (?, ?, ?)",
      [socket.userId, title, content],
      (err) => {
        if (!err) {
          io.emit('news_posted', {
            author: socket.name,
            title: title,
            content: content,
            time: new Date().toLocaleTimeString('ar')
          });
        }
      }
    );
  });

  // ===== DISCONNECT =====
  socket.on('disconnect', () => {
    for (let n in onlineUsers) {
      if (onlineUsers[n] === socket.id) {
        delete onlineUsers[n];
        if (socket.userId) {
          db.run("UPDATE members SET is_online = 0, last_seen = ? WHERE id = ?",
            [new Date().toISOString(), socket.userId]);
        }
      }
    }
    sendOnlineUsers(socket.currentRoom);
  });

  // ===== HELPER FUNCTION =====
  function sendOnlineUsers(room) {
    db.all("SELECT id, name, rank FROM members WHERE is_online = 1", [], (err, dbUsers) => {
      let users = (dbUsers || []).map(u => ({
        name: u.name,
        rank: u.rank,
        online: onlineUsers[u.name] ? true : false
      }));
      io.to(room).emit('users_list', users);
    });
  }
});

// ===== FILE UPLOAD ENDPOINTS =====
app.post('/upload-avatar', upload.single('file'), (req, res) => {
  const { userId } = req.body;
  if (!userId || !req.file) return res.status(400).send('Missing data');

  const fileUrl = '/uploads/' + req.file.filename;
  db.run("UPDATE me