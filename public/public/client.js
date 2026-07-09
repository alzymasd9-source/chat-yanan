const socket = io();
const user = JSON.parse(localStorage.getItem('user'));
document.getElementById('roomName').innerText = user.room;

socket.emit('joinRoom', user, user.room);

socket.on('chatMessage', (data)=>{
  const border = data.user.gender=='blue'?'border-blue-500':data.user.gender=='pink'?'border-pink-500':'border-white';
  document.getElementById('chatArea').innerHTML += `
  <div class="flex gap-2 mb-3 border-r-4 ${border} pr-2">
    <img src="https://i.pravatar.cc/40" class="w-10 h-10 rounded">
    <div>
      <span style="color:${data.user.color}">${data.user.username}</span>
      <span class="text-xs text-gray-400">${data.time}</span>
      <p>${data.text}</p>
    </div>
    <button onclick="report('${data.user.username}')">•••</button>
  </div>`;
  document.getElementById('chatArea').scrollTop = 99999;
});

socket.on('userList', (users)=>{
  document.getElementById('userList').innerHTML = users
   .sort((a,b)=> Object.keys(permissions).indexOf(a.rank) - Object.keys(permissions).indexOf(b.rank))
   .map(u=>`<div class="p-1">${getRankIcon(u.rank)} ${u.username}</div>`).join('');
});

function sendMsg(){
  const text = document.getElementById('msgInput').value;
  if(text.trim()=='') return;
  socket.emit('chatMessage', {text});
  document.getElementById('msgInput').value = '';
}

function report(username){
  socket.emit('report', {from:user.username, to:username, reason:'اساءة', time:new Date()});
}

function getRankIcon(rank){
  const icons = {'زائر':'🤖','عضو':'👤','مميز':'💎','مشرف':'🛡️','ادارة':'☆','ادمن':'⭐','المالك':'👑'}
  return icons[rank] || '👤';
}