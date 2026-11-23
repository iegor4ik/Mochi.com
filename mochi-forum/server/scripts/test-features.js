/**
 * Интеграционный тест новых функций M-o-chi.com:
 *  - фикс профиля (bio/signature PUT, аватар multipart)
 *  - подписки (follow/unfollow, счётчики, уведомления)
 *  - приватность ЛС (dm_policy: all/followers/following)
 *  - посты профиля (CRUD, видимость public/personal/private, теги, sanitize)
 *  - лента (recent/popular/following)
 *  - тема к посту (только автор, один раз, «Тема: …»)
 *  - поиск по #тегу
 *  - загрузка шрифта
 *
 * Запуск: node scripts/test-features.js  (сервер должен быть запущен)
 */
const BASE = process.env.BASE_URL || 'http://localhost:3000';

let passed = 0;
let failed = 0;
const fails = [];

function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
}

async function req(method, path, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (form) {
    // content-type задаст FormData сам
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: form ? form : body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, data };
}

const stamp = Date.now().toString(36);

async function register(name) {
  const r = await req('POST', '/api/auth/register', {
    body: { username: name, email: `${name}@test.local`, password: 'password123' },
  });
  if (r.status !== 201) throw new Error(`регистрация ${name} не удалась: ${JSON.stringify(r.data)}`);
  return r.data; // {token, user}
}

async function part1(A, B, C) {
  console.log('≡ Фикс профиля: PUT /users/me и аватар');
  const put = await req('PUT', '/api/users/me', {
    token: A.token,
    body: { bio: 'Тестовое описание профиля', signature: 'Тестовая подпись' },
  });
  check('PUT /users/me сохраняет bio+signature', put.status === 200
    && put.data.user.bio === 'Тестовое описание профиля'
    && put.data.user.signature === 'Тестовая подпись', JSON.stringify(put.data));

  // минимальный PNG 1x1
  const png = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
    '0000000d4944415478da63fcffff3f0300050201f34a24d50000000049454e44ae426082', 'hex');
  const fd = new FormData();
  fd.append('image', new Blob([png], { type: 'image/png' }), 'avatar.png');
  const av = await req('POST', '/api/users/me/avatar', { token: A.token, form: fd });
  check('POST /users/me/avatar принимает multipart-файл', av.status === 200 && /^\/uploads\//.test(av.data.url || ''), JSON.stringify(av.data));
  const avCheck = await req('GET', `/api/users/${A.user.username}`);
  check('аватар записался в профиль', avCheck.data.user.avatar_url === av.data.url);

  console.log('≡ Подписки');
  const f1 = await req('POST', `/api/users/${B.user.username}/follow`, { token: A.token, body: {} });
  check('A подписывается на B', f1.status === 200 && f1.data.following === true);
  const f2 = await req('POST', `/api/users/${B.user.username}/follow`, { token: A.token, body: {} });
  check('повторная подписка идемпотентна', f2.status === 200);
  const profB = await req('GET', `/api/users/${B.user.username}`, { token: A.token });
  check('счётчик подписчиков у B = 1', profB.data.user.followers_count === 1, JSON.stringify(profB.data.user));
  check('is_following у A для B = true', profB.data.user.is_following === true);
  const selfFollow = await req('POST', `/api/users/${A.user.username}/follow`, { token: A.token, body: {} });
  check('нельзя подписаться на себя', selfFollow.status === 400);
  const notifB = await req('GET', '/api/notifications?limit=50', { token: B.token });
  check('B получил уведомление о подписке', notifB.data.items.some((n) => n.type === 'follow'));

  console.log('≡ Приватность ЛС (dm_policy)');
  const pol = await req('PUT', '/api/users/me', { token: B.token, body: { dm_policy: 'followers' } });
  check('B включил «только подписчики»', pol.status === 200 && pol.data.user.dm_policy === 'followers');
  const dm1 = await req('POST', '/api/chat/conversations', { token: C.token, body: { username: B.user.username } });
  check('C (не подписчик) не может написать B', dm1.status === 403, JSON.stringify(dm1.data));
  await req('POST', `/api/users/${B.user.username}/follow`, { token: C.token, body: {} });
  const dm2 = await req('POST', '/api/chat/conversations', { token: C.token, body: { username: B.user.username } });
  check('C (подписчик) может написать B', dm2.status === 201, JSON.stringify(dm2.data));

  await req('PUT', '/api/users/me', { token: B.token, body: { dm_policy: 'following' } });
  const dm3 = await req('POST', '/api/chat/conversations', { token: C.token, body: { username: B.user.username } });
  check('при «только те, на кого подписан» C заблокирован', dm3.status === 403);
  await req('POST', `/api/users/${C.user.username}/follow`, { token: B.token, body: {} });
  const dm4 = await req('POST', '/api/chat/conversations', { token: C.token, body: { username: B.user.username } });
  check('теперь C может писать (B подписан на C)', dm4.status === 201, JSON.stringify(dm4.data));
  await req('PUT', '/api/users/me', { token: B.token, body: { dm_policy: 'all' } });
}

async function part2a(A, B, C) {
  console.log('≡ Посты профиля: создание и санитизация');
  const html = '<h2>Заголовок</h2><p>Текст <b>жирный</b> <span style="font-size:1.3em">крупный</span> ' +
    '<script>alert(1)</script><img src="javascript:alert(2)"><img src="/uploads/demo-mochi.svg">' +
    '<a href="javascript:evil()">зло</a><a href="https://example.com">ок-ссылка</a></p>';
  const cp = await req('POST', '/api/user-posts', {
    token: A.token,
    body: {
      title: 'Пост с тегом',
      visibility: 'public',
      tags: ['#Моти', 'тест'],
      content: { html, fonts: [] },
    },
  });
  check('пост создан', cp.status === 201 && cp.data.post.id > 0, JSON.stringify(cp.data));
  const postId = cp.data.post.id;
  const savedHtml = cp.data.post.content?.html || '';
  check('script вырезан вместе с содержимым', !savedHtml.includes('<script') && !savedHtml.includes('alert(1)'));
  check('img с javascript:-URL вырезан', !savedHtml.includes('javascript:alert(2)'));
  check('валидный img сохранён', savedHtml.includes('/uploads/demo-mochi.svg'));
  check('javascript:-ссылка вырезана, обычная осталась', !savedHtml.includes('evil()') && savedHtml.includes('https://example.com'));
  check('теги нормализованы (# срезан, lowercase)', JSON.stringify(cp.data.post.tags) === JSON.stringify(['моти', 'тест']), JSON.stringify(cp.data.post.tags));
  const noTitle = await req('POST', '/api/user-posts', { token: A.token, body: { title: '' } });
  check('без названия пост не создаётся', noTitle.status === 400);

  console.log('≡ Видимость постов');
  const visData = (v) => ({ title: `Пост ${v}`, visibility: v, content: { html: '<p>x</p>', fonts: [] } });
  const persPost = await req('POST', '/api/user-posts', { token: A.token, body: visData('personal') });
  const privPost = await req('POST', '/api/user-posts', { token: A.token, body: visData('private') });
  check('созданы личный и приватный посты', persPost.status === 201 && privPost.status === 201);

  const listAForC = await req('GET', `/api/user-posts?author=${A.user.username}`, { token: C.token });
  const visSet = listAForC.data.items.map((p) => p.visibility).sort();
  check('чужой видит public+personal, не видит private', JSON.stringify(visSet) === JSON.stringify(['personal', 'public']), JSON.stringify(visSet));
  const listAForA = await req('GET', `/api/user-posts?author=${A.user.username}`, { token: A.token });
  check('автор видит все свои посты', listAForA.data.items.length === 3, JSON.stringify(listAForA.data.items.map((p) => p.visibility)));
  const privDirect = await req('GET', `/api/user-posts/${privPost.data.post.id}`, { token: C.token });
  check('приватный доступен по прямой ссылке', privDirect.status === 200 && privDirect.data.post.title === 'Пост private');
  check('счётчик просмотров растёт у не-автора', privDirect.data.post.views === 1, `views=${privDirect.data.post.views}`);
  const privDirectA = await req('GET', `/api/user-posts/${privPost.data.post.id}`, { token: A.token });
  check('у автора просмотры не растут', privDirectA.data.post.views === 1, `views=${privDirectA.data.post.views}`);
  return { postId, persPost };
}

async function part2b(A, B, C, postId, persPost) {
  console.log('≡ Лента');
  const feedRecent = await req('GET', '/api/feed?tab=recent');
  check('недавние: публичный пост A присутствует', feedRecent.status === 200 && feedRecent.data.items.some((p) => p.id === postId));
  const feedPopular = await req('GET', '/api/feed?tab=popular');
  check('популярные: ответ 200', feedPopular.status === 200);
  await req('POST', `/api/users/${A.user.username}/follow`, { token: C.token, body: {} });
  const feedFollow = await req('GET', '/api/feed?tab=following', { token: C.token });
  check('подписки: посты A видны подписчику C', feedFollow.status === 200 && feedFollow.data.items.some((p) => p.id === postId));
  const feedAnon = await req('GET', '/api/feed?tab=following');
  check('гостю лента подписок недоступна (401)', feedAnon.status === 401);

  console.log('≡ Поиск по #тегу');
  const s1 = await req('GET', `/api/search?q=${encodeURIComponent('#моти')}`);
  check('пост найден по #тегу', s1.status === 200 && s1.data.tagPosts?.items.some((p) => p.id === postId), JSON.stringify(s1.data).slice(0, 200));
  const s2 = await req('GET', `/api/search?q=${encodeURIComponent('Пост с тегом')}`);
  check('пост найден по названию (обычный поиск)', s2.data.articles?.items.some((p) => p.id === postId));

  console.log('≡ Редактирование и права');
  const patch = await req('PATCH', `/api/user-posts/${postId}`, {
    token: A.token,
    body: { title: 'Пост обновлён', content: { html: '<p>новый текст</p>', fonts: [] }, tags: ['обновлено'] },
  });
  check('автор редактирует пост', patch.status === 200 && patch.data.post.title === 'Пост обновлён');
  const patchOther = await req('PATCH', `/api/user-posts/${postId}`, { token: C.token, body: { title: 'взлом' } });
  check('чужой не может редактировать (403)', patchOther.status === 403);
  const topicOther = await req('POST', `/api/user-posts/${postId}/topic`, { token: C.token, body: {} });
  check('тему создаёт только автор поста (403)', topicOther.status === 403);

  console.log('≡ Тема к посту');
  const topic = await req('POST', `/api/user-posts/${postId}/topic`, { token: A.token, body: {} });
  check('тема создана автором, название «Тема: …»', topic.status === 201 && topic.data.topic.title === 'Тема: Пост обновлён', JSON.stringify(topic.data));
  const topicDup = await req('POST', `/api/user-posts/${postId}/topic`, { token: A.token, body: {} });
  check('вторая тема к тому же посту запрещена', topicDup.status === 400);
  const postWithTopic = await req('GET', `/api/user-posts/${postId}`);
  check('пост связан с темой', postWithTopic.data.topic && postWithTopic.data.topic.id === topic.data.topic.id);

  console.log('≡ Удаление постов');
  const delOther = await req('DELETE', `/api/user-posts/${postId}`, { token: C.token });
  check('чужой не может удалить пост (403)', delOther.status === 403);
  const delOwn = await req('DELETE', `/api/user-posts/${persPost.data.post.id}`, { token: A.token });
  check('автор удаляет свой пост', delOwn.status === 200);
  const delGone = await req('GET', `/api/user-posts/${persPost.data.post.id}`);
  check('удалённый пост недоступен (404)', delGone.status === 404);
}

async function part3(A, B, C) {
  console.log('≡ Загрузка шрифта');
  const ttf = Buffer.concat([Buffer.from('0001000000040000', 'hex'), Buffer.alloc(256, 7)]);
  const ffd = new FormData();
  ffd.append('font', new Blob([ttf], { type: 'font/ttf' }), 'Test Font.ttf');
  const fontUp = await req('POST', '/api/upload/font', { token: A.token, form: ffd });
  check('шрифт загружен, имя+url возвращены', fontUp.status === 201
    && /^\/uploads\/fonts\/.+\.(ttf|otf|woff2?)$/.test(fontUp.data.url || '')
    && fontUp.data.name === 'Test Font', JSON.stringify(fontUp.data));
  const ffd2 = new FormData();
  ffd2.append('font', new Blob([Buffer.from('MThd')], { type: 'audio/mpeg' }), 'song.mp3');
  const badFont = await req('POST', '/api/upload/font', { token: A.token, form: ffd2 });
  check('не-шрифт отклонён', badFont.status >= 400, JSON.stringify(badFont.data));

  console.log('≡ Отписка');
  const unf = await req('DELETE', `/api/users/${B.user.username}/follow`, { token: A.token });
  check('A отписался от B', unf.status === 200 && unf.data.following === false);
}

async function main() {
  console.log('≡ Регистрация тестовых пользователей');
  const A = await register(`tf_a_${stamp}`);
  const B = await register(`tf_b_${stamp}`);
  const C = await register(`tf_c_${stamp}`);
  check('регистрация 3 пользователей', !!A.token && !!B.token && !!C.token);

  await part1(A, B, C);
  const { postId, persPost } = await part2a(A, B, C);
  await part2b(A, B, C, postId, persPost);
  await part3(A, B, C);

  console.log(`\nИтог: ✓ ${passed} · ✗ ${failed}`);
  if (failed) {
    console.log('Провалены проверки:');
    fails.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('[test-features] fatal:', e.message);
  process.exit(1);
});