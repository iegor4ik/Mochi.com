/**
 * Сид демо-данных для M-o-chi.com.
 * Запуск: npm run seed [-- --force]   (--force — очистить таблицы и засеять заново)
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool } = require('../src/config/db');

const force = process.argv.includes('--force');

const DEMO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300" viewBox="0 0 480 300">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#ff5c8a"/><stop offset="1" stop-color="#7c5cff"/></linearGradient></defs>
<rect width="480" height="300" rx="24" fill="#12172a"/>
<circle cx="240" cy="150" r="86" fill="url(#g)"/>
<circle cx="212" cy="122" r="26" fill="#ffffff" opacity=".35"/>
<text x="240" y="278" font-family="Segoe UI,sans-serif" font-size="22" fill="#e8ecf8" text-anchor="middle">M-o-chi.com</text>
</svg>`;

async function main() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM users');
  if (rows[0].n > 0 && !force) {
    console.log('Сид пропущен: в базе уже есть пользователи (используйте --force для пересева).');
    await pool.end();
    return;
  }
  if (force) {
    console.log('Очищаю таблицы ...');
    await pool.query(`
      TRUNCATE likes, messages, conversations, notifications, reports, bans,
               posts, topics, categories, users RESTART IDENTITY CASCADE`);
  }

  // --- Демо-картинка в uploads ---
  const uploadDir = path.join(__dirname, '..', 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  fs.writeFileSync(path.join(uploadDir, 'demo-mochi.svg'), DEMO_SVG);

  // --- Пользователи ---
  const hash = (p) => bcrypt.hashSync(p, 10);
  const users = [
    ['admin',       'admin@mochi.com',      hash('admin123'),    'admin',     'Главный по мочи. Пишите в поддержку, если что-то сломалось.', '🍡 M-o-chi.com'],
    ['moderator',   'mod@mochi.com',        hash('mod12345'),    'moderator', 'Следим за порядком на форуме.', 'Порядок — это вкусно.'],
    ['sakura',      'sakura@mochi.com',     hash('sakura123'),   'user',      'Люблю дизайн и рисовать моти.', '🌸'],
    ['tech_guy',    'tech@mochi.com',       hash('tech12345'),   'user',      'Node.js, PostgreSQL, Docker. Отвечаю быстро.', 'console.log("hi")'],
    ['newbie_kate', 'kate@mochi.com',       hash('kate12345'),   'user',      'Только зарегистрировалась, всем привет!', ''],
  ];
  for (const [u, e, h, r, bio, sig] of users) {
    await pool.query(
      `INSERT INTO users (username, email, password_hash, role, bio, signature)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [u, e, h, r, bio, sig]
    );
  }

  // --- Категории ---
  const cats = [
    ['Общие обсуждения', 'general', 'Знакомимся, болтаем обо всём на свете.', '💬', '#7c5cff', 1],
    ['Технологии',       'tech',    'Код, железо, софт и всё вокруг IT.',    '💻', '#4da3ff', 2],
    ['Игры',             'games',   'Видеоигры, стримы и киберспорт.',       '🎮', '#ffb84d', 3],
    ['Искусство и дизайн','art',    'Рисунки, UI/UX, фотография.',           '🎨', '#ff5c8a', 4],
    ['Флудилка',         'flood',   'Мемы, оффтоп и лёгкий трёп.',           '🍡', '#4ddba3', 5],
  ];
  for (const c of cats) {
    await pool.query(
      `INSERT INTO categories (name, slug, description, icon, color, position)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      c
    );
  }

  // --- Темы и посты ---
  async function addTopic(catSlug, author, title, content, pinned = false, locked = false) {
    const cat = (await pool.query('SELECT id FROM categories WHERE slug=$1', [catSlug])).rows[0];
    const usr = (await pool.query('SELECT id FROM users WHERE username=$1', [author])).rows[0];
    const slug = title.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 180) || 'topic';
    const t = (
      await pool.query(
        `INSERT INTO topics (category_id, author_id, title, slug, content, pinned, locked)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [cat.id, usr.id, title, slug, content, pinned, locked]
      )
    ).rows[0];
    return t.id;
  }

  async function addPost(topicId, author, content, parentPostId = null, image = null) {
    const usr = (await pool.query('SELECT id FROM users WHERE username=$1', [author])).rows[0];
    const p = (
      await pool.query(
        `INSERT INTO posts (topic_id, author_id, parent_post_id, content, image_url)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [topicId, usr.id, parentPostId, content, image]
      )
    ).rows[0];
    await pool.query(
      `UPDATE topics SET post_count = post_count + 1, last_activity_at = now() WHERE id = $1`,
      [topicId]
    );
    return p.id;
  }

  async function like(username, postId) {
    const u = (await pool.query('SELECT id FROM users WHERE username=$1', [username])).rows[0];
    await pool.query(`INSERT INTO likes (user_id, post_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [u.id, postId]);
    await pool.query(`UPDATE posts SET like_count = (SELECT COUNT(*) FROM likes WHERE post_id=$1) WHERE id=$1`, [postId]);
  }

  const rulesContent = `Добро пожаловать на M-o-chi.com! 🍡

Несколько простых правил:
1. Уважайте друг друга — никаких оскорблений и травли.
2. Не спамьте и не рекламируйте сторонние сервисы.
3. Публикуйте темы в подходящих категориях.
4. Жалобы на нарушения отправляйте через кнопку «Жалоба».

Приятного общения!`;
  const tRules = await addTopic('general', 'admin',
    'Правила форума M-o-chi.com — прочитайте перед началом общения',
    rulesContent, true, true);
  await addPost(tRules, 'sakura', 'Спасибо за тёплый приём! Форум выглядит потрясающе 💕');
  await addPost(tRules, 'tech_guy', 'Дизайн с выделенной буквой «O» — топ. Логотип прямо мота-шарик.');

  const welcomeContent = `Предлагаю классическую тему знакомств!

Я Сакура, люблю рисовать и дизайнить интерфейсы. А вы кто и чем увлекаетесь?`;
  const tWelcome = await addTopic('general', 'sakura',
    'Знакомимся: расскажите о себе', welcomeContent);
  const pW1 = await addPost(tWelcome, 'tech_guy', 'Привет! Я Максим, бэкенд-разработчик. Пишу на Node.js, кручу Docker.');
  await addPost(tWelcome, 'newbie_kate', 'Всем привет! Я Катя, только что зарегистрировалась. Учусь на дизайнера.');
  await addPost(tWelcome, 'sakura', 'Катя, добро пожаловать! Если любишь рисовать — заглядывай в категорию «Искусство» 🎨', pW1);
  await like('admin', pW1);
  await like('sakura', pW1);
  await like('moderator', pW1);

  const nodeContent = `Собираю новый проект и думаю над фреймворком. Express — проверенная классика с огромной экосистемой, Fastify — скорость из коробки и схемы.

Что используете вы и какие подводные камни встречали?`;
  const tNode = await addTopic('tech', 'tech_guy',
    'Express vs Fastify в 2026 году: что выбираете и почему?', nodeContent);
  const pN1 = await addPost(tNode, 'admin', 'Для сообществ вроде этого Express хватает за глаза, а экосистема middleware решает почти всё.');
  await addPost(tNode, 'tech_guy', 'Согласен. Плюс с pg-pool и грамотными индексами узким местом будет не фреймворк, а БД.');
  await addPost(tNode, 'sakura', 'А я фронтендщица, но даже мне понятно: выбирайте то, что знаете лучше 😄', pN1);
  await like('moderator', pN1);

  const pgContent = `Коротко о том, что ускоряет форумные запросы:

• B-tree по (category_id, last_activity_at DESC) — сортировка ленты тем;
• частичный индекс по deleted=false для постов;
• GIN по tsvector, если нужен полнотекстовый поиск;
• составной PK (user_id, post_id) для лайков защищает от дублей.

Добавляйте свои рецепты!`;
  const tPg = await addTopic('tech', 'admin',
    'Шпаргалка по индексам PostgreSQL для форумов', pgContent);
  await addPost(tPg, 'tech_guy', 'Ещё стоит не забывать про VACUUM ANALYZE после массовых удалений.');

  const tGames = await addTopic('games', 'newbie_kate',
    'Во что играете вечерами? Делитесь находками',
    'Ищу что-нибудь уютное под вечер: не хоррор, не раннер. Может, инди-жемчужины посоветуете?');
  await addPost(tGames, 'sakura', 'Stardew Valley — вечная классика уюта. Ещё Spiritfarer, если готовы поплакать 🌙');
  await addPost(tGames, 'tech_guy', 'Hades. Идеален короткими заходами, билды затягивают.');

  const tArt = await addTopic('art', 'sakura',
    'Покажите свой рабочий стол / сетап художника',
    'Интересно, где и на чём вы творите. Вот мой сетап: планшет, куча стикеров и чашка чая обязательна!');
  await addPost(tArt, 'sakura', '', null, '/uploads/demo-mochi.svg');
  await addPost(tArt, 'newbie_kate', 'Какой уютный градиент! А какой планшет?');

  const tFlood = await addTopic('flood', 'moderator',
    'Мемная тема: опишите свой день эмодзи',
    'Правила простые: один комментарий — одно описание дня только эмодзи. Начну: ☕🐛🔧🎉');
  await addPost(tFlood, 'tech_guy', '💻☕☕🍜😴');
  await addPost(tFlood, 'admin', '🍡🍡🍡✅');

  // --- Личный чат ---
  async function conv(a, b) {
    const ua = (await pool.query('SELECT id FROM users WHERE username=$1', [a])).rows[0];
    const ub = (await pool.query('SELECT id FROM users WHERE username=$1', [b])).rows[0];
    const lo = Math.min(ua.id, ub.id), hi = Math.max(ua.id, ub.id);
    return (
      await pool.query(
        `INSERT INTO conversations (user1_id, user2_id) VALUES ($1,$2)
         ON CONFLICT (user1_id,user2_id) DO UPDATE SET last_message_at=now()
         RETURNING id`,
        [lo, hi]
      )
    ).rows[0].id;
  }
  async function msg(convId, sender, content, image = null, read = true) {
    const u = (await pool.query('SELECT id FROM users WHERE username=$1', [sender])).rows[0];
    await pool.query(
      `INSERT INTO messages (conversation_id, sender_id, content, image_url, read_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [convId, u.id, content, image, read ? new Date() : null]
    );
    await pool.query(`UPDATE conversations SET last_message_at = now() WHERE id = $1`, [convId]);
  }
  const c1 = await conv('admin', 'sakura');
  await msg(c1, 'sakura', 'Привет! Хотела уточнить: можно ли менять акцентный цвет темы?', null, true);
  await msg(c1, 'admin', 'Привет! Конечно — в настройках есть целый конструктор тем 🎨', null, true);
  await msg(c1, 'sakura', 'Ух ты, нашла! Экспорт темы одной кнопкой — красота.', null, true);
  await msg(c1, 'admin', 'Кстати, вот логотип в высоком разрешении:', '/uploads/demo-mochi.svg', false);

  const c2 = await conv('tech_guy', 'newbie_kate');
  await msg(c2, 'newbie_kate', 'Здравствуйте! Подскажите, с чего начать изучение SQL?', null, true);
  await msg(c2, 'tech_guy', 'Начните с SELECT/JOIN на реальной базе — например, разверните наш форум локально и пишите запросы к нему 😉', null, false);

  // --- Уведомления ---
  const ids = {
    admin: (await pool.query(`SELECT id FROM users WHERE username='admin'`)).rows[0].id,
    sakura: (await pool.query(`SELECT id FROM users WHERE username='sakura'`)).rows[0].id,
    tech: (await pool.query(`SELECT id FROM users WHERE username='tech_guy'`)).rows[0].id,
    kate: (await pool.query(`SELECT id FROM users WHERE username='newbie_kate'`)).rows[0].id,
  };
  await pool.query(
    `INSERT INTO notifications (user_id, type, actor_id, entity_type, entity_id, payload)
     VALUES ($1,'reply',$2,'post',$3,$4),
            ($1,'like',$5,'post',$3,$6)`,
    [ids.tech, ids.sakura, pN1, JSON.stringify({ topic_id: tNode }), ids.admin, JSON.stringify({ topic_id: tNode })]
  );
  await pool.query(
    `INSERT INTO notifications (user_id, type, actor_id, entity_type, entity_id, payload)
     VALUES ($1,'message',$2,'conversation',$3,$4)`,
    [ids.kate, ids.tech, c2, JSON.stringify({ from: 'tech_guy' })]
  );

  // --- Жалоба (пример открытой) ---
  await pool.query(
    `INSERT INTO reports (reporter_id, target_type, target_id, reason)
     VALUES ($1,'post',$2,'Возможно, ссылка ведёт на подозрительный сайт')`,
    [ids.kate, pW1]
  );

  console.log('✔ Сид выполнен. Демо-аккаунты:');
  console.log('  admin / admin123      (администратор)');
  console.log('  moderator / mod12345  (модератор)');
  console.log('  sakura / sakura123, tech_guy / tech12345, newbie_kate / kate12345 (пользователи)');
  await pool.end();
}

main().catch((e) => {
  console.error('[seed] fatal:', e.message);
  process.exit(1);
});