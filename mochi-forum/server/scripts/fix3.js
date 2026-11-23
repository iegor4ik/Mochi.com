const fs = require('fs');
const f = 'c:/Users/LOQ/Desktop/mochi/mochi-forum/public/js/chats/chat.js';
let s = fs.readFileSync(f, 'utf8');
const from = '<div class="msg-bubble">${esc(p.content || \'\')}';
const to = '<div class="msg-bubble">${UI.renderMd(p.content || \'\')}';
if (s.includes(to)) { console.log('already applied'); process.exit(0); }
const cnt = s.split(from).length - 1;
if (!cnt) { console.log('NOT FOUND'); process.exit(1); }
s = s.split(from).join(to);
fs.writeFileSync(f, s);
console.log('pinned modal renderMd OK, replaced:', cnt);
