/**
 * Интеграционный тест всех функций API M-o-chi.com.
 * Запуск: node scripts/test-api.js   (сервер должен быть запущен на :3000)
 */
const BASE = 'http://localhost:3000/api';
let passed = 0, failed = 0;

function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; console.log(`  ✘ FAIL: ${name} ${extra}`); }
}

async function req(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

async function main() {
  console.log('\n=== 1. Публичные эндпоинты ===');
  const cats = await req('GET', '/categories');
  ok('GET /categories', cats.status === 200 && cats.data.items.length >= 5);
  const topics = await req('GET', '/topics?limit=5&page=1');
  ok('GET /topics (лента)', topics.status === 200 && topics.data.items.length > 0);
  ok('Пагинация отдаёт totalPages', typeof topics.data.totalPages === 'number' && topics.data.total >= topics.data.items.length);
  const sorted = await req('GET', '/topics?sort=new');
  ok('GET /topics?sort=new', sorted.status === 200);

  console.log('\n=== 2. Валидация и защита ===');
  const badReg = await req('POST', '/auth/register', { body: { username: 'x!', email: 'bad', password: '123' } });
  ok('Регистрация с мусором → 400', badReg.status === 400);
  const noAuth = await req('GET', '/auth/me');
  ok('/auth/me без токена → 401', noAuth.status === 401);
  const noAdmin = await req('GET', '/admin/stats');
  ok('/admin/stats без токена → 401', noAdmin.status === 401);
  const shortSearch = await req('GET', '/search?q=a');
  ok('Поиск <2 символов → 400', shortSearch.status === 400);

  console.log('\n=== 3. Регистрация/логин ===');
  const uname = 'tester_' + Date.now().toString(36);
  const reg = await req('POST', '/auth/register', {
    body: { username: uname, email: `${uname}@t.io`, password: 'password123' },
  });
  ok('Регистрация нового юзера → 201', reg.status === 201 && reg.data.token);
  const dupReg = await req('POST', '/auth/register', {
    body: { username: uname, email: `other@t.io`, password: 'password123' },
  });
  ok('Дубликат имени → 400', dupReg.status === 400);
  const login = await req('POST', '/auth/login', { body: { login: uname, password: 'password123' } });
  ok('Логин по имени', login.status === 200 && login.data.token);
  const badLogin = await req('POST', '/auth/login', { body: { login: uname, password: 'wrongpass99' } });
  ok('Неверный пароль → 401', badLogin.status === 401);
  const me = await req('GET', '/auth/me', { token: reg.data.token });
  ok('GET /auth/me с токеном', me.status === 200 && me.data.user.username === uname);

  // логин админа
  const admin = await req('POST', '/auth/login', { body: { login: 'admin@mochi.com', password: 'admin123' } });
  ok('Логин админа по email', admin.status === 200 && admin.data.user.role === 'admin');
  const mod = await req('POST', '/auth/login', { body: { login: 'moderator', password: 'mod12345' } });
  ok('Логин модератора', mod.status === 200 && mod.data.user.role === 'moderator');
  const T = reg.data.token, A = admin.data.token, M = mod.data.token;

  console.log('\n=== 4. Профили ===');
  const prof = await req('GET', `/users/${uname}`);
  ok('Профиль пользователя', prof.status === 200 && prof.data.user.topics_count === 0);
  const upd = await req('PUT', '/users/me', { token: T, body: { bio: 'Тестовый био', signature: '~тест~', theme: { mode: 'light', accent: '#00ff00', radius: 999 } } });
  ok('Обновление профиля+темы', upd.status === 200 && upd.data.user.theme.mode === 'light'
     && upd.data.user.theme.radius <= 28, JSON.stringify(upd.data.user.theme));
  const profTopics = await req('GET', `/users/${uname}/topics`);
  ok('Темы пользователя (пусто)', profTopics.status === 200 && profTopics.data.total === 0);

  console.log('\n=== 5. Темы и посты ===');
  const newTopic = await req('POST', '/topics', {
    token: T,
    body: { category_id: cats.data.items[0].id, title: 'Тестовая тема про моти', content: 'Это содержимое тестовой темы, достаточно длинное.' },
  });
  ok('Создание темы → 201', newTopic.status === 201 && newTopic.data.topic.id);
  const tid = newTopic.data.topic.id;
  const tooShort = await req('POST', '/topics', { token: T, body: { category_id: 1, title: 'короткий', content: 'текст' } });
  ok('Короткий заголовок → 400', tooShort.status === 400);

  const reply = await req('POST', `/topics/${tid}/posts`, { token: M, body: { content: 'Ответ модератора в тестовую тему' } });
  ok('Ответ в тему → 201', reply.status === 201 && reply.data.post.id);
  const pid = reply.data.post.id;
  const nested = await req('POST', `/topics/${tid}/posts`, { token: T, body: { content: 'Вложенный ответ', parent_post_id: pid } });
  ok('Ответ на ответ (parent)', nested.status === 201 && nested.data.post.parent_post_id === pid);

  const postsList = await req('GET', `/topics/${tid}/posts`);
  ok('Список постов темы (ОП в topics + 2 ответа)', postsList.status === 200 && postsList.data.items.length === 2);

  const editPost = await req('PATCH', `/posts/${pid}`, { token: M, body: { content: 'Отредактированный ответ' } });
  ok('Редактирование поста автором', editPost.status === 200 && editPost.data.post.edited === true);
  const editForeign = await req('PATCH', `/posts/${pid}`, { token: T, body: { content: 'взломано?' } });
  ok('Чужой пост редактировать нельзя → 403', editForeign.status === 403);

  const like1 = await req('POST', `/posts/${pid}/like`, { token: T });
  ok('Лайк поста', like1.status === 200 && like1.data.liked === true && like1.data.like_count === 1);
  const like2 = await req('POST', `/posts/${pid}/like`, { token: T });
  ok('Повторный лайк снимает', like2.status === 200 && like2.data.liked === false && like2.data.like_count === 0);

  const delPost = await req('DELETE', `/posts/${nested.data.post.id}`, { token: T });
  ok('Удаление своего поста', delPost.status === 200);
  const postsAfter = await req('GET', `/topics/${tid}/posts`);
  ok('Мягкое удаление скрывает пост', postsAfter.data.items.length === 1);

  const pinByUser = await req('PATCH', `/topics/${tid}`, { token: T, body: { pinned: true } });
  ok('Юзер не может закрепить тему → 403', pinByUser.status === 403);
  const pinByMod = await req('PATCH', `/topics/${tid}`, { token: M, body: { pinned: true, locked: true } });
  ok('Модератор закрепляет/закрывает тему', pinByMod.status === 200 && pinByMod.data.topic.pinned === true);
  const postLocked = await req('POST', `/topics/${tid}/posts`, { token: T, body: { content: 'пост в закрытой теме' } });
  ok('Пост в закрытой теме → 403', postLocked.status === 403);
  await req('PATCH', `/topics/${tid}`, { token: M, body: { locked: false, pinned: false } });

  console.log('\n=== 6. Уведомления ===');
  // автор темы (T) получает reply от модератора; модератор — like от T
  const notifT = await req('GET', '/notifications', { token: T });
  ok('Автор темы получил уведомление об ответе', notifT.status === 200 && notifT.data.items.some((n) => n.type === 'reply'));
  const notifM = await req('GET', '/notifications', { token: M });
  ok('Автор поста получил уведомление о лайке', notifM.status === 200 && notifM.data.items.some((n) => n.type === 'like'));
  const unreadBefore = await req('GET', '/notifications/unread-count', { token: T });
  ok('unread-count > 0', unreadBefore.status === 200 && unreadBefore.data.count > 0);
  await req('POST', '/notifications/read', { token: T, body: {} });
  const unreadAfter = await req('GET', '/notifications/unread-count', { token: T });
  ok('После «прочитать всё» count=0', unreadAfter.data.count === 0);

  console.log('\n=== 7. Личный чат ===');
  const conv = await req('POST', '/chat/conversations', { token: T, body: { username: 'sakura' } });
  ok('Создание диалога', conv.status === 201 && conv.data.conversation.id);
  const cid = conv.data.conversation.id;
  const selfConv = await req('POST', '/chat/conversations', { token: T, body: { username: uname } });
  ok('Диалог с собой → 400', selfConv.status === 400);
  const msg1 = await req('POST', `/chat/conversations/${cid}/messages`, { token: T, body: { content: 'Привет, Сакура!' } });
  ok('Отправка сообщения', msg1.status === 201);
  const msgImg = await req('POST', `/chat/conversations/${cid}/messages`, { token: T, body: { content: '', image_url: '/uploads/demo-mochi.svg' } });
  ok('Сообщение-картинка (url)', msgImg.status === 201);
  const emptyMsg = await req('POST', `/chat/conversations/${cid}/messages`, { token: T, body: { content: '' } });
  ok('Пустое сообщение → 400', emptyMsg.status === 400);
  const sakuraLogin = await req('POST', '/auth/login', { body: { login: 'sakura', password: 'sakura123' } });
  const S = sakuraLogin.data.token;
  const sakuraMsgs = await req('GET', `/chat/conversations/${cid}/messages`, { token: S });
  ok('Получатель видит сообщения', sakuraMsgs.status === 200 && sakuraMsgs.data.items.length === 2);
  const foreignConv = await req('GET', `/chat/conversations/${cid}/messages`, { token: M });
  ok('Чужой диалог недоступен → 403', foreignConv.status === 403);
  const afterId = await req('GET', `/chat/conversations/${cid}/messages?after_id=${msg1.data.message.id}`, { token: T });
  ok('Инкрементальная выборка (after_id)', afterId.status === 200 && afterId.data.items.length === 1);

  console.log('\n=== 8. Поиск ===');
  const searchT = await req('GET', '/search?q=' + encodeURIComponent('моти'));
  ok('Поиск тем', searchT.status === 200 && searchT.data.topics.total > 0);
  const searchU = await req('GET', '/search?q=sakura&type=users');
  ok('Поиск пользователей', searchU.status === 200 && searchU.data.users.total > 0);

  console.log('\n=== 9. Жалобы ===');
  const rep = await req('POST', '/reports', { token: T, body: { target_type: 'post', target_id: pid, reason: 'Тестовая жалоба на пост' } });
  ok('Создание жалобы → 201', rep.status === 201);
  const repDup = await req('POST', '/reports', { token: T, body: { target_type: 'post', target_id: pid, reason: 'Дубль жалобы тут' } });
  ok('Дубликат открытой жалобы → 400', repDup.status === 400);
  const repAsUser = await req('GET', '/reports', { token: T });
  ok('Список жалоб юзеру недоступен → 403', repAsUser.status === 403);
  const repList = await req('GET', '/reports?status=open', { token: M });
  ok('Модератор видит жалобу', repList.status === 200 && repList.data.items.some((r) => r.id === rep.data.report.id));
  const target = await req('GET', `/reports/target?type=post&id=${pid}`, { token: M });
  ok('Превью объекта жалобы', target.status === 200 && target.data.target.content.includes('Отредактированный'));
  const resolve = await req('PATCH', `/reports/${rep.data.report.id}`, { token: M, body: { status: 'resolved', note: 'ок' } });
  ok('Обработка жалобы', resolve.status === 200 && resolve.data.report.status === 'resolved');

  console.log('\n=== 10. Админка ===');
  const stats = await req('GET', '/admin/stats', { token: A });
  ok('Статистика', stats.status === 200 && stats.data.stats.users_total >= 6);
  const usersList = await req('GET', '/admin/users?q=tester', { token: A });
  ok('Поиск пользователей в админке', usersList.status === 200 && usersList.data.items.length >= 1);
  const meRow = usersList.data.items.find((u) => u.username === uname) || usersList.data.items[0];
  const uid = meRow.id;
  const ban = await req('PATCH', `/admin/users/${uid}`, { token: A, body: { action: 'ban', days: 7, reason: 'Тестовый бан' } });
  ok('Бан на 7 дней', ban.status === 200 && ban.data.banned === true);
  const bannedMe = await req('GET', '/auth/me', { token: T });
  ok('Забаненный получает 403 на действия', bannedMe.status === 403 && bannedMe.data.banned === true);
  const unban = await req('PATCH', `/admin/users/${uid}`, { token: A, body: { action: 'unban' } });
  ok('Разбан', unban.status === 200);
  const meAgain = await req('GET', '/auth/me', { token: T });
  ok('После разбана доступ восстановлен', meAgain.status === 200);
  const promote = await req('PATCH', `/admin/users/${uid}`, { token: A, body: { role: 'moderator' } });
  ok('Смена роли на moderator', promote.status === 200);
  const demote = await req('PATCH', `/admin/users/${uid}`, { token: A, body: { role: 'user' } });
  ok('Возврат роли user', demote.status === 200);
  const bansHistory = await req('GET', '/admin/bans', { token: A });
  ok('История банов', bansHistory.status === 200 && bansHistory.data.items.length >= 1);
  const catCreate = await req('POST', '/categories', { token: A, body: { name: 'Тестовая категория', description: 'для теста', icon: '🧪' } });
  ok('Создание категории (admin)', catCreate.status === 201);
  const catDel = await req('DELETE', `/categories/${catCreate.data.category.id}`, { token: A });
  ok('Удаление категории', catDel.status === 200);
  const delSelf = await req('DELETE', `/admin/users/${admin.data.user.id}`, { token: A });
  ok('Админ не может удалить себя → 400', delSelf.status === 400);

  console.log('\n=== 11. Загрузка файлов ===');
  const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const pngBuf = Buffer.from(pngB64, 'base64');
  const fd = new FormData();
  fd.append('image', new Blob([pngBuf], { type: 'image/png' }), 'dot.png');
  const upl = await fetch(BASE + '/upload', { method: 'POST', headers: { Authorization: `Bearer ${T}` }, body: fd });
  const uplData = await upl.json();
  ok('Загрузка изображения → 201', upl.status === 201 && uplData.url.startsWith('/uploads/'));

  console.log('\n========================================');
  console.log(`ИТОГО: ${passed} прошло, ${failed} упало`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });