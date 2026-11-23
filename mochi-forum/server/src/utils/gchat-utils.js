/**
 * Утилиты групповых чатов (чатсов): права ролей, системные фразы,
 * санитайзеры описания/фона/темы, typing-хранилище.
 */
const { sanitizePostContent, sanitizeImageUrl } = require('./post-utils');

/** Права ролей в чатсе */
const PERMS = [
  'manage',    // настройки чата, дизайн, описание, теги, подчатсы
  'roles',     // создание/изменение/выдача ролей
  'kick',      // выгонять участников
  'ban',       // банить участников
  'mute',      // глушить участников
  'requests',  // одобрять/отклонять заявки
  'invite',    // приглашать по никнейму
  'pin',       // закреплять и чистить сообщения
  'moderate',  // удалять чужие сообщения
  'personas',  // одобрять/отклонять персоны
];

/** Права встроенной роли «куратор» */
const CURATOR_PERMS = ['mute', 'requests', 'personas'];

/**
 * Проверить право пользователя в чате.
 * @param {object} chat строка gchats
 * @param {object|null} member строка gchat_members (null — не участник)
 * @param {object} user req.user
 * @param {string} perm ключ права
 */
function hasPerm(chat, member, user, perm) {
  if (!user) return false;
  if (['moderator', 'admin'].includes(user.role)) return true; // админка сайта видит всё
  if (!member) return false;
  if (chat.owner_id === user.id) return true;
  if (member.role === 'curator') return CURATOR_PERMS.includes(perm);
  if (member.role_id && Array.isArray(member.permissions)) {
    return member.permissions.includes(perm);
  }
  return false;
}

/** Список прав с учётом кастомной роли */
function memberPerms(chat, member, user) {
  return PERMS.filter((p) => hasPerm(chat, member, user, p));
}

/* ---------- Забавные фразы входа в чат ---------- */
const JOIN_PHRASES = [
  '{u} вступил(а) в чат',
  '{u} присоединился(ась) к компании 🎉',
  '{u} прикатился(ась) как моти-шар 🍡',
  'Постучитесь-постучались — и вот он(а), {u}!',
  '{u} теперь с нами. Ура-ура!',
  'Тихо-тихо… {u} зашёл(шла) в чат 👀',
  '{u} открыл(а) дверь и вошёл(ла) 🚪✨',
  'Незваный гость? Нет, это {u} — званый!',
  '{u} вступил(а) в чат. Будьте вкуснее!',
  'Аплодисменты! {u} в чате 👏',
];

const LEAVE_PHRASES = [
  '{u} покинул(а) чат',
  '{u} растворился(лась) в закате 🌅',
  '{u} ушёл(шла). Моти будет скучать 🍡',
  'Дверь закрылась. {u} покинул(а) нас.',
];

const PIN_PHRASES = {
  pinned: '📌 {u} закрепил(а) сообщение',
  unpinned: '{u} открепил(а) сообщение',
  cleared: '🧹 {u} очистил(а) историю сообщений',
};

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Системная фраза входа */
function joinPhrase(username) {
  return pick(JOIN_PHRASES).replace('{u}', username);
}
function leavePhrase(username) {
  return pick(LEAVE_PHRASES).replace('{u}', username);
}
/* ---------- Санитайзеры ---------- */

/** Описание чата — как содержимое поста {html, fonts} */
function sanitizeDescription(content) {
  return sanitizePostContent(content);
}

/** Фон описания: {type: color|gradient|image, color, color2, url} */
function sanitizeDescBg(bg) {
  const out = { type: 'color', color: '#f4f6fc', color2: '#dfe8ff', url: null };
  if (!bg || typeof bg !== 'object') return out;
  if (['color', 'gradient', 'image'].includes(bg.type)) out.type = bg.type;
  const hex = /^#[0-9a-fA-F]{6}$/;
  if (typeof bg.color === 'string' && hex.test(bg.color)) out.color = bg.color;
  if (typeof bg.color2 === 'string' && hex.test(bg.color2)) out.color2 = bg.color2;
  if (bg.type === 'image') {
    const url = bg.url ? sanitizeImageUrl(bg.url) : null;
    if (url) out.url = url;
    else out.type = 'color';
  }
  return out;
}

/**
 * Тема оформления чатса: применяется ко всей странице чата
 * (кроме header/подвала секции Mochi chats).
 */
function sanitizeChatTheme(t) {
  const out = {};
  if (!t || typeof t !== 'object') return out;
  if (['light', 'dark'].includes(t.mode)) out.mode = t.mode;
  const hex = /^#[0-9a-fA-F]{6}$/;
  if (typeof t.accent === 'string' && hex.test(t.accent)) out.accent = t.accent;
  if (typeof t.accent2 === 'string' && hex.test(t.accent2)) out.accent2 = t.accent2;
  if (Number.isFinite(+t.radius)) out.radius = Math.min(28, Math.max(4, +t.radius));
  if (typeof t.bubble === 'string' && hex.test(t.bubble)) out.bubble = t.bubble;
  if (typeof t.pageBg === 'string' && hex.test(t.pageBg)) out.pageBg = t.pageBg;
  if (t.bgImage) {
    const url = sanitizeImageUrl(t.bgImage);
    if (url) out.bgImage = url;
  }
  if (t.fonts) out.fonts = sanitizePostContent({ html: '', fonts: t.fonts }).fonts;
  return out;
}

/** Иконка чата: emoji до 3 символов либо /uploads/… либо http(s) картинка */
function sanitizeIcon(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\p{Extended_Pictographic}{1,3}$/u.test(s)) return s.slice(0, 12);
  return sanitizeImageUrl(s);
}

/* ---------- Typing (в памяти процесса) ---------- */
const typingMap = new Map(); // key `${chatId}:${subchatId||0}` -> Map(userId -> {username, expires})

function setTyping(chatId, subchatId, userId, username) {
  const key = `${chatId}:${subchatId || 0}`;
  if (!typingMap.has(key)) typingMap.set(key, new Map());
  typingMap.get(key).set(userId, { username, expires: Date.now() + 6000 });
}

function getTyping(chatId, subchatId, excludeUserId) {
  const key = `${chatId}:${subchatId || 0}`;
  const m = typingMap.get(key);
  if (!m) return [];
  const now = Date.now();
  const out = [];
  for (const [uid, val] of m) {
    if (val.expires < now) { m.delete(uid); continue; }
    if (uid === excludeUserId) continue;
    out.push({ user_id: uid, username: val.username });
  }
  return out;
}

/** Извлечь @упоминания из текста: массив никнеймов (lowercase) */
function extractMentions(text) {
  const out = [];
  const re = /@([A-Za-z0-9_а-яёА-ЯЁ.-]{2,32})/g;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) {
    const name = m[1].toLowerCase();
    if (!out.includes(name)) out.push(name);
    if (out.length >= 10) break;
  }
  return out;
}

module.exports = {
  PERMS, CURATOR_PERMS, hasPerm, memberPerms,
  joinPhrase, leavePhrase, PIN_PHRASES, pick,
  sanitizeDescription, sanitizeDescBg, sanitizeChatTheme, sanitizeIcon,
  setTyping, getTyping, extractMentions,
};

