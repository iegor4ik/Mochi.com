/**
 * Интеграционный тест групповых чатов (чатсов) M-o-chi.com.
 * Покрывает: 3 вида чатсов, заявки раз в сутки, запрет заявок, баны, мут, кик,
 * роли (до 5) и права, куратор, персоны (аноним/публичн, по заявке, only),
 * подчатсы (до 5), закрепление/очистка, упоминания, ответы, typing,
 * лента (recent/popular/subs), поиск и #теги, тема «Чатс: …», игнор, ЛС.
 *
 * Запуск: node scripts/test-gchats.js  (сервер должен быть запущен)
 */
const BASE = process.env.BASE_URL || 'http://localhost:3000';

let passed = 0;
let failed = 0;
const fails = [];

function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  OK ${name}`); }
  else { failed++; fails.push(name); console.log(`  FAIL ${name} ${extra}`); }
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
  try { data = await res.json(); } catch { /* пусто */ }
  return { status: res.status, data };
}

const stamp = Date.now().toString(36);

async function register(name) {
  const r = await req('POST', '/api/auth/register', {
    body: { username: name, email: `${name}@test.local`, password: 'password123' },
  });
  if (r.status !== 201) throw new Error(`register ${name} failed: ${JSON.stringify(r.data)}`);
  return r.data; // {token, user}
}

async function main() {
  console.log('== users');
  const A = await register(`gca_${stamp}`); // владелец
  const B = await register(`gcb_${stamp}`);
  const C = await register(`gcc_${stamp}`);
  check('3 пользователя зарегистрированы', !!(A.user && B.user && C.user));

  /* ---------- ПУБЛИЧНЫЙ ЧАТС ---------- */
  console.log('== public chat: create + join');
  const mk = await req('POST', '/api/gchats', {
    token: A.token,
    body: {
      kind: 'public',
      name: 'Тестовый чатс',
      icon: '🍡',
      tags: 'тест, моти',
      description: { html: '<p>Привет! <script>alert(1)</script><b>Моти</b></p>', fonts: [] },
      desc_bg: { type: 'gradient', color: '#ff5c8a', color2: '#7c5cff' },
      msg_visibility: 'everyone',
    },
  });
  check('создание публичного чатса', mk.status === 201 && mk.data.chat.id > 0, JSON.stringify(mk.data));
  const chatId = mk.data.chat.id;
  check('санитайзер вырезал <script>', !(mk.data.chat.description.html || '').includes('script'));
  check('теги нормализованы', mk.data.chat.tags.length === 2 && mk.data.chat.tags[0] === 'тест' && mk.data.chat.tags[1] === 'моти', JSON.stringify(mk.data.chat.tags));

  const anon = await req('GET', `/api/gchats/${chatId}`);
  check('гость видит описание публичного чатса', anon.status === 200 && anon.data.chat.member_count === 1);
  check('гость может смотреть сообщения (everyone)', anon.data.can_view_messages === true);

  const joinB = await req('POST', `/api/gchats/${chatId}/join`, { token: B.token });
  check('B вступил в публичный чатс', joinB.status === 200 && joinB.data.joined === true, JSON.stringify(joinB.data));

  const pageB = await req('GET', `/api/gchats/${chatId}`, { token: B.token });
  check('в чатсе теперь 2 участника', pageB.data.chat.member_count === 2, `member_count=${pageB.data.chat.member_count}`);

  const msgs1 = await req('GET', `/api/gchats/${chatId}/messages`, { token: B.token });
  const sysMsg = msgs1.data.items.find((m) => m.kind === 'system');
  check('системная фраза входа с вариацией', !!sysMsg && sysMsg.content.length > 5, sysMsg && sysMsg.content);
  /* ---------- СООБЩЕНИЯ / УПОМИНАНИЯ / TYPING ---------- */
  console.log('== messages, mentions, typing');
  const send1 = await req('POST', `/api/gchats/${chatId}/messages`, {
    token: B.token,
    body: { content: `Привет, @${A.user.username}! Как дела?` },
  });
  check('B отправил сообщение с упоминанием', send1.status === 201, JSON.stringify(send1.data));
  check('упоминание найдено', (send1.data.message.mentioned_ids || []).includes(A.user.id));

  const notifA = await req('GET', '/api/notifications?types=mention', { token: A.token });
  check('уведомление об упоминании пришло A', notifA.data.items.length >= 1 && notifA.data.items[0].type === 'mention');

  const send2 = await req('POST', `/api/gchats/${chatId}/messages`, { token: A.token, body: { content: `ещё @${B.user.username}` } });
  check('повторное упоминание', send2.status === 201);
  const notifB = await req('GET', '/api/notifications?types=mention', { token: B.token });
  check('уведомление B об упоминании', notifB.data.items.length >= 1);

  const typing = await req('POST', `/api/gchats/${chatId}/typing`, { token: A.token });
  check('typing отправлен', typing.status === 200);
  const msgsB = await req('GET', `/api/gchats/${chatId}/messages`, { token: B.token });
  check('B видит «A печатает»', (msgsB.data.typing || []).some((t) => t.user_id === A.user.id));

  const answer = await req('POST', `/api/gchats/${chatId}/messages`, {
    token: A.token,
    body: { content: 'Это ответ', reply_to_id: send1.data.message.id },
  });
  check('ответ на сообщение создан', answer.status === 201 && answer.data.message.reply_to_id === send1.data.message.id, JSON.stringify(answer.data));
  /* ---------- ЗАЯВКИ (request) ---------- */
  console.log('== request chat: once a day, requests block');
  const mkReq = await req('POST', '/api/gchats', {
    token: A.token,
    body: { kind: 'request', name: 'По заявке', msg_visibility: 'members' },
  });
  const reqChatId = mkReq.data.chat.id;

  const pageC1 = await req('GET', `/api/gchats/${reqChatId}`, { token: C.token });
  check('C видит описание, но не сообщения (members)', pageC1.status === 200 && pageC1.data.can_view_messages === false);

  const joinC1 = await req('POST', `/api/gchats/${reqChatId}/join`, { token: C.token });
  check('C подал заявку', joinC1.status === 201 && joinC1.data.requested === true, JSON.stringify(joinC1.data));

  const joinC2 = await req('POST', `/api/gchats/${reqChatId}/join`, { token: C.token });
  check('повторная заявка уже на рассмотрении', joinC2.status === 400);

  const reqsA = await req('GET', `/api/gchats/${reqChatId}/requests`, { token: A.token });
  check('A видит заявку C', reqsA.status === 200 && reqsA.data.items.length === 1);

  const approve = await req('POST', `/api/gchats/${reqChatId}/requests/${reqsA.data.items[0].id}`, {
    token: A.token, body: { action: 'approve' },
  });
  check('A одобрил заявку', approve.status === 200);

  const pageC2 = await req('GET', `/api/gchats/${reqChatId}`, { token: C.token });
  check('C теперь участник', pageC2.data.me.is_member === true);

  const notifC = await req('GET', '/api/notifications?types=chat_approved', { token: C.token });
  check('C получил уведомление об одобрении', notifC.data.items.length >= 1);

  const leaveC = await req('POST', `/api/gchats/${reqChatId}/leave`, { token: C.token });
  check('C покинул чатс', leaveC.status === 200);
  const joinC3 = await req('POST', `/api/gchats/${reqChatId}/join`, { token: C.token });
  check('заявка раз в сутки (кулдаун)', joinC3.status === 400 && /сутки/.test(joinC3.data.error), JSON.stringify(joinC3.data));

  const blockC = await req('POST', `/api/gchats/${reqChatId}/ban`, {
    token: A.token, body: { user_id: C.user.id, kind: 'requests_block', reason: 'спам заявками' },
  });
  check('A запретил C заявки', blockC.status === 200, JSON.stringify(blockC.data));

  const D = await register(`gcd_${stamp}`);
  const joinD1 = await req('POST', `/api/gchats/${reqChatId}/join`, { token: D.token });
  check('D может подать заявку (его не блокировали)', joinD1.status === 201);
  /* ---------- ПРИВАТНЫЙ ЧАТС ---------- */
  console.log('== private chat: invite-only, visible in DM');
  const mkPriv = await req('POST', '/api/gchats', {
    token: A.token,
    body: { kind: 'private', name: 'Приватный кружок', initial_member: B.user.username, private_open: true },
  });
  check('приватный чатс создан', mkPriv.status === 201, JSON.stringify(mkPriv.data));
  const privId = mkPriv.data.chat.id;
  const privPageB = await req('GET', `/api/gchats/${privId}`, { token: B.token });
  check('приватный чатс создан с участником B', privPageB.status === 200 && privPageB.data.chat.member_count === 2 && privPageB.data.me.is_member, JSON.stringify(privPageB.data.chat?.member_count));

  const privC = await req('GET', `/api/gchats/${privId}`, { token: C.token });
  check('C получает 404 на чужой приватный', privC.status === 404);

  const privJoinC = await req('POST', `/api/gchats/${privId}/join`, { token: C.token });
  check('вступление в приватный запрещено', privJoinC.status === 403);

  const invC = await req('POST', `/api/gchats/${privId}/invite`, { token: B.token, body: { username: C.user.username } });
  check('B пригласил C (private_open — участник может)', invC.status === 201, JSON.stringify(invC.data));

  const invListC = await req('GET', '/api/gchats/invites', { token: C.token });
  check('C видит приглашение', invListC.data.items.length === 1);

  const accC = await req('POST', `/api/gchats/invites/${invListC.data.items[0].id}`, { token: C.token, body: { action: 'accept' } });
  check('C принял приглашение', accC.status === 200 && accC.data.joined === true);

  const convB = await req('GET', '/api/chat/conversations', { token: B.token });
  check('приватный чатс в списке ЛС у B', (convB.data.groups || []).some((g) => g.id === privId), JSON.stringify(convB.data.groups || []));
  /* ---------- ПЕРСОНЫ ---------- */
  console.log('== personas: anonymous/public, approval, personas-only');
  const enP = await req('PATCH', `/api/gchats/${chatId}`, { token: A.token, body: { personas_enabled: true } });
  check('A включил персоны', enP.status === 200 && enP.data.chat.personas_enabled === true);

  const pB = await req('POST', `/api/gchats/${chatId}/personas`, {
    token: B.token,
    body: { name: 'Тень B', visibility: 'anonymous', bio: 'секретная персона' },
  });
  check('B создал анонимную персону', pB.status === 201 && pB.data.persona.status === 'approved');

  const pSendB = await req('POST', `/api/gchats/${chatId}/messages`, {
    token: B.token, body: { content: 'Сообщение от персоны', persona_id: pB.data.persona.id },
  });
  check('B написал от лица персоны', pSendB.status === 201 && pSendB.data.message && pSendB.data.message.persona_id === pB.data.persona.id, JSON.stringify(pSendB.data));

  const pMsgsA = await req('GET', `/api/gchats/${chatId}/messages`, { token: A.token });
  const pmA = pMsgsA.data.items?.find((m) => m.id === pSendB.data.message?.id);
  check('владелец видит автора анонимной персоны', pmA && pmA.persona && pmA.persona.owner_username === B.user.username, JSON.stringify(pmA?.persona));

  const pMsgsC = await req('GET', `/api/gchats/${chatId}/messages`, { token: C.token });
  const pmC = pMsgsC.data.items?.find((m) => m.id === pSendB.data.message?.id);
  check('обычный участник НЕ видит автора анонимной персоны', pmC && pmC.persona && pmC.persona.owner_username === null, JSON.stringify(pmC?.persona));

  await req('POST', `/api/gchats/${chatId}/join`, { token: C.token }); // C должен быть участником
  const pC = await req('POST', `/api/gchats/${chatId}/personas`, {
    token: C.token, body: { name: 'Открытая C', visibility: 'public' },
  });
  check('C создал публичную персону', pC.status === 201, JSON.stringify(pC.data));

  const onlyP = await req('PATCH', `/api/gchats/${chatId}`, { token: A.token, body: { personas_only: true } });
  check('включён режим «только для персон»', onlyP.status === 200);

  const sendNoP = await req('POST', `/api/gchats/${chatId}/messages`, { token: D.token, body: { content: 'без персоны' } });
  check('сообщение без персоны отклонено (или D не участник)', sendNoP.status === 400 || sendNoP.status === 403, JSON.stringify(sendNoP.data));

  await req('PATCH', `/api/gchats/${chatId}`, { token: A.token, body: { personas_only: false } });

  /* ---------- Персоны по заявке ---------- */
  console.log('== personas with approval');
  const chatP = await req('POST', '/api/gchats', { token: A.token, body: { kind: 'public', name: 'Персоны по заявке', personas_enabled: true, personas_approval: true } });
  check('чатс с персонами-по-заявке создан', chatP.status === 201 && chatP.data.chat && chatP.data.chat.id, JSON.stringify(chatP.data));
  const pChatId = chatP.data.chat.id;
  await req('POST', `/api/gchats/${pChatId}/join`, { token: B.token });
  const pB2 = await req('POST', `/api/gchats/${pChatId}/personas`, {
    token: B.token, body: { name: 'Нужна одобрение', visibility: 'public' },
  });
  check('персона B на одобрении', pB2.status === 201 && pB2.data.persona.status === 'pending', JSON.stringify(pB2.data));

  const sendPend = await req('POST', `/api/gchats/${pChatId}/messages`, {
    token: B.token, body: { content: 'рано', persona_id: pB2.data.persona.id },
  });
  check('неподтверждённой персоной писать нельзя', sendPend.status === 400);

  const revA = await req('POST', `/api/gchats/${pChatId}/personas/${pB2.data.persona.id}/review`, {
    token: A.token, body: { action: 'approve' },
  });
  check('A одобрил персону', revA.status === 200);
  const ntfB = await req('GET', '/api/notifications?types=persona_approved', { token: B.token });
  check('B получил уведомление об одобрении', ntfB.data.items.length >= 1);
  /* ---------- РОЛИ И ПРАВА ---------- */
  console.log('== roles (max 5), custom perms, curator');
  const r1 = await req('POST', `/api/gchats/${chatId}/roles`, { token: A.token, body: { name: 'Пиннер', color: '#3ecf8e', permissions: ['pin'] } });
  check('роль создана', r1.status === 201);
  const rolePinId = r1.data.role.id;

  for (let i = 0; i < 4; i++) {
    await req('POST', `/api/gchats/${chatId}/roles`, { token: A.token, body: { name: `Роль ${i}`, permissions: [] } });
  }
  const r6 = await req('POST', `/api/gchats/${chatId}/roles`, { token: A.token, body: { name: 'Шестая', permissions: [] } });
  check('6-я роль отклонена (макс. 5)', r6.status === 400);

  const setRoleB = await req('POST', `/api/gchats/${chatId}/members/${B.user.id}/role`, {
    token: A.token, body: { role_id: rolePinId },
  });
  check('роль Пиннер назначена B', setRoleB.status === 200);

  const pinByB = await req('POST', `/api/gchats/${chatId}/messages/${send1.data.message.id}/pin`, { token: B.token, body: {} });
  check('B с правом pin закрепил сообщение', pinByB.status === 200, JSON.stringify(pinByB.data));

  const kickByB = await req('DELETE', `/api/gchats/${chatId}/members/${C.user.id}`, { token: B.token });
  check('B без права kick не может выгнать', kickByB.status === 403);

  const pinnedList = await req('GET', `/api/gchats/${chatId}/pinned`, { token: C.token });
  check('закреплённое видно в /pinned', pinnedList.data.items.length >= 1);

  // куратор: mute
  const curB = await req('POST', `/api/gchats/${chatId}/members/${B.user.id}/role`, { token: A.token, body: { role: 'curator' } });
  check('B назначен куратором', curB.status === 200);
  await req('POST', `/api/gchats/${chatId}/join`, { token: C.token });
  const muteC = await req('POST', `/api/gchats/${chatId}/mute`, { token: B.token, body: { user_id: C.user.id, minutes: 30 } });
  check('куратор B заглушил C', muteC.status === 200, JSON.stringify(muteC.data));

  const sendCMuted = await req('POST', `/api/gchats/${chatId}/messages`, { token: C.token, body: { content: 'я заглушен?' } });
  check('заглушенный C не может писать', sendCMuted.status === 403);

  const unmuteC = await req('POST', `/api/gchats/${chatId}/unmute`, { token: A.token, body: { user_id: C.user.id } });
  check('A снял мут', unmuteC.status === 200);
  /* ---------- БАН / КИК / ОЧИСТКА ---------- */
  console.log('== ban, kick, clear');
  const banC = await req('POST', `/api/gchats/${chatId}/ban`, {
    token: A.token, body: { user_id: C.user.id, days: 7, reason: 'тест-бан' },
  });
  check('A забанил C на 7 дней', banC.status === 200);

  const pageC3 = await req('GET', `/api/gchats/${chatId}`, { token: C.token });
  check('C видит бан на странице', pageC3.data.my_ban && pageC3.data.my_ban.kind === 'ban');

  const joinCBanned = await req('POST', `/api/gchats/${chatId}/join`, { token: C.token });
  check('забаненный C не может вступить', joinCBanned.status === 403);

  const unbanC = await req('POST', `/api/gchats/${chatId}/unban`, { token: A.token, body: { user_id: C.user.id } });
  check('A разбанил C', unbanC.status === 200);

  await req('POST', `/api/gchats/${chatId}/join`, { token: C.token }); // C возвращается (бан удалил его из участников)
  const kickC = await req('DELETE', `/api/gchats/${chatId}/members/${C.user.id}`, { token: A.token });
  check('A выгнал C', kickC.status === 200, JSON.stringify(kickC.data));

  const clearAll = await req('DELETE', `/api/gchats/${chatId}/messages`, { token: A.token });
  check('A очистил все сообщения', clearAll.status === 200);
  const afterClear = await req('GET', `/api/gchats/${chatId}/messages`, { token: A.token });
  check('после очистки только системное сообщение', afterClear.data.items.length === 1 && afterClear.data.items[0].kind === 'system');

  /* ---------- ПОДЧАТСЫ ---------- */
  console.log('== subchats (max 5)');
  const sc1 = await req('POST', `/api/gchats/${chatId}/subchats`, { token: A.token, body: { name: 'Флудилка', icon: '🍕' } });
  check('подчатс создан', sc1.status === 201);
  const scId = sc1.data.subchat.id;
  for (let i = 0; i < 4; i++) {
    await req('POST', `/api/gchats/${chatId}/subchats`, { token: A.token, body: { name: `Подчатс ${i}` } });
  }
  const sc6 = await req('POST', `/api/gchats/${chatId}/subchats`, { token: A.token, body: { name: 'Шестой' } });
  check('6-й подчатс отклонён', sc6.status === 400);

  const scMsg = await req('POST', `/api/gchats/${chatId}/messages`, { token: A.token, body: { content: 'в подчатсе', subchat_id: scId } });
  check('сообщение в подчатс', scMsg.status === 201 && scMsg.data.message.subchat_id === scId);
  const scList = await req('GET', `/api/gchats/${chatId}/messages?subchat_id=${scId}`, { token: A.token });
  check('сообщения подчатса фильтруются', scList.data.items.length === 1);
  /* ---------- ЛЕНТА / ПОИСК / ТЕМА / ИГНОР ---------- */
  console.log('== feed, search, topic, ignore');
  const feedRecent = await req('GET', '/api/gchats?tab=recent', { token: D.token });
  check('лента recent содержит публичные чатсы', feedRecent.data.items.some((c) => c.id === chatId));
  check('приватные в ленте не участвуют', !feedRecent.data.items.some((c) => c.kind === 'private'));

  const feedPopular = await req('GET', '/api/gchats?tab=popular');
  const counts = feedPopular.data.items.map((c) => c.member_count);
  check('лента popular отсортирована по участникам', counts.every((n, i) => i === 0 || counts[i - 1] >= n));

  await req('POST', `/api/users/${A.user.username}/follow`, { token: D.token });
  const feedSubs = await req('GET', '/api/gchats?tab=subs', { token: D.token });
  check('лента подписок показывает чатсы A', feedSubs.data.items.some((c) => c.owner_id === A.user.id));

  const searchTag = await req('GET', `/api/search?q=${encodeURIComponent('#тест')}&type=chats`);
  check('поиск по #тегу находит чатс', searchTag.status === 200 && (searchTag.data.chats?.items || []).some((c) => c.id === chatId), JSON.stringify(searchTag.data).slice(0, 200));

  const searchName = await req('GET', `/api/search?q=${encodeURIComponent('Тестовый')}&type=all`);
  check('общий поиск находит чатс по названию', searchName.data.chats && searchName.data.chats.items.some((c) => c.id === chatId));

  const topic = await req('POST', `/api/gchats/${chatId}/topic`, { token: A.token });
  check('тема «Чатс: …» создана', topic.status === 201 && topic.data.topic.title === 'Чатс: Тестовый чатс', topic.data.topic && topic.data.topic.title);
  const topicDup = await req('POST', `/api/gchats/${chatId}/topic`, { token: A.token });
  check('повторная тема отклонена', topicDup.status === 400);

  // игнор: D вступает и игнорирует B
  await req('POST', `/api/gchats/${chatId}/join`, { token: D.token });
  const sendB3 = await req('POST', `/api/gchats/${chatId}/messages`, { token: B.token, body: { content: 'виден ли я D?' } });
  const igD = await req('POST', '/api/gchats/ignore', { token: D.token, body: { user_id: B.user.id, ignored: true } });
  check('D включил игнор B', igD.status === 200);
  const msgsD2 = await req('GET', `/api/gchats/${chatId}/messages`, { token: D.token });
  const hiddenMsg = msgsD2.data.items.find((m) => m.id === sendB3.data.message.id);
  check('сообщение от игнорируемого скрыто', hiddenMsg && hiddenMsg.hidden === true && hiddenMsg.content === null);
  /* ---------- ПРАВА ДОСТУПА ---------- */
  console.log('== permissions');
  const patchByB = await req('PATCH', `/api/gchats/${chatId}`, { token: B.token, body: { name: 'Взломано' } });
  check('участник без права manage не может менять настройки', patchByB.status === 403, JSON.stringify(patchByB.data));

  const delByB = await req('DELETE', `/api/gchats/${chatId}`, { token: B.token });
  check('не-владелец не может удалить чатс', delByB.status === 403);

  const notifBadge = await req('GET', '/api/gchats/notif-badge', { token: B.token });
  check('бейдж уведомлений отвечает', notifBadge.status === 200 && typeof notifBadge.data.total === 'number');

  /* ---------- ИТОГИ ---------- */
  console.log(`\n== RESULT: ${passed} OK, ${failed} FAIL`);
  if (fails.length) {
    console.log('Failed checks:');
    fails.forEach((f) => console.log('  FAIL ' + f));
    process.exit(1);
  }








}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
