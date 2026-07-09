const socket = io();
const user = JSON.parse(localStorage.getItem('user'));
document.getElementById('roomName').innerText = user.room;
if(['ادارة','ادمن','المالك'].includes(user.rank)) adminBtn.style.display='block';
if(['مميز','مشرف','ادارة','ادمن','المالك'].includes(user.rank)) uploadBtn.style.display='block';

socket.emit('joinRoom', user, user.room);

socket.on('chatMessage', (data)=>{
  const rankClass = 'rank-' + data.user.rank.replace(' ', '');
  document.getElementById('chatArea').innerHTML += `
  <div class="chat-bubble ${rankClass} flex gap-2" id="msg-${data.id}">
    <img src="https://i.pravatar.cc/40?u=${data.user.username}" class="w-10 h-10 rounded-full">
    <div class="flex-1">
      <div class="flex justify-between">
        <span style="color:${data.user.color}; font-size:${data.user.fontSize}px">${getRankIcon(data.user.rank)} ${data.user.username}</span>
        <span class="text-xs text-gray-400">${data.time}</span>
      </div>
      <p>${data.text}</p>
      ${can(user.rank,'deleteMsg')? `<button onclick="deleteMsg('${data.id}')">حذف</button>` : ''}
    </div>
  </div>`;
  chatArea.scrollTop = 99999;
});

socket.on('userList', (users)=>{
  userList.innerHTML = users.sort((a,b)=>Object.keys(permissions).indexOf(a.rank)-Object.keys(permissions).indexOf(b.rank))
 .map(u=>`<div class="p-2 hover:bg-gray-700 cursor-pointer" onclick="openUserMenu('${u.username}', '${u.socketId}')">${getRankIcon(u.rank)} ${u.username}</div>`).join('');
});

function sendMsg(){ const text = msgInput.value; if(text.trim()=='') return; socket.emit('chatMessage', {text}); msgInput.value=''; }
function deleteMsg(id){ socket.emit('deleteMessage', id); document.getElementById('msg-'+id).remove(); }
function report(username){ socket.emit('report', {from:user.username, to:username, reason:'اساءة', time:new Date()}); }
function getRankIcon(rank){ const icons = {'زائر':'🤖','عضو':'👤','مميز':'💎','مشرف':'🛡️','ادارة':'☆','ادمن':'⭐','المالك':'👑'}; return icons[rank] || '👤'; }
function can(rank, action){ const permissions = {'زائر':['chat'],'عضو':['chat','pm'],'مميز':['upload'],'مشرف':['mute'],'ادارة':['logs'],'المالك':['all']}; return permissions[rank]?.includes(action) || rank === 'المالك' }

async function uploadFile(){ let file = fileInput.files[0]; let form = new FormData(); form.append('file', file); let res = await fetch('/upload', {method:'POST', body: form}); let data = await res.json(); socket.emit('chatMessage', {text: `<img src="${data.url}" class="max-w-xs rounded">`}); }
function showUpload(){ youtubeBox.classList.toggle('hidden'); fileInput.click(); }
function sendYoutube(){ let link = youtubeLink.value; socket.emit('chatMessage', {text: `<iframe width="300" src="${link.replace('watch?v=','embed/')}" frameborder="0"></iframe>`}); }
async function startVoice(){ await navigator.mediaDevices.getUserMedia({audio: true}); socket.emit('voiceOn', user.username); }
function playRadio(){ radio.paused? radio.play() : radio.pause(); }
function toggleMute(){ radio.muted =!radio.muted; }
socket.on('muted', (m)=>{ alert(`تم كتمك ${m} دقائق`); msgInput.disabled = true; setTimeout(()=> msgInput.disabled = false, m*60000); });
socket.on('kicked', (m)=>{ alert(`تم طردك ${m} دقائق`); setTimeout(()=> location.href='/rooms.html', 1000); });
socket.on('deleteMsg', (id)=> document.getElementById('msg-'+id)?.remove());