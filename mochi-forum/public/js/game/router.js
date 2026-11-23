/**
 * Hash-роутинг игры «Хаб»: #/game (лобби-заглушка) и #/game/world/hub (мир).
 * Не пересекается с маршрутами форума и чатсов (у тех свои SPA-роутеры).
 * Подключение: REST игры (fetch + Bearer из localStorage.mochi_token), WS — GameNet.
 */
window.GameRouter = (() => {
  const CFG = window.GAME_CONFIG;

  const app = () => document.getElementById('app');

  /* ---------- ожидание входа (токен появляется в другой вкладке форума) ---------- */

  let tokenWatch = null;

  function stopTokenWatch() {
    if (!tokenWatch) return;
    clearInterval(tokenWatch.iv);
    window.removeEventListener('storage', tokenWatch.check);
    window.removeEventListener('focus', tokenWatch.check);
    tokenWatch = null;
  }

  /** Как только на форуме залогинились (token в localStorage) — продолжаем в игре */
  function watchTokenUntil() {
    stopTokenWatch();
    const check = () => {
      if (localStorage.getItem('mochi_token')) {
        stopTokenWatch();
        if (/^#\/game\/world\//.test(location.hash)) location.reload(); // мир — свежая сессия
        else route();                                                    // лобби — перерисовка
      }
    };
    window.addEventListener('storage', check); // другой таб форума записал токен
    window.addEventListener('focus', check);   // вернулись на вкладку игры
    tokenWatch = { iv: setInterval(check, 2000), check };
  }

  /** Карточка «нужен вход» (используется лобби и миром) */
  function loginCard(message, hint) {
    stopTokenWatch();
    app().innerHTML = `
      <div class="game-card">
        <h2>🍡 Игра «Хаб»</h2>
        <p class="muted">${UI.esc(message)}</p>
        ${hint ? `<p class="game-hint">${UI.esc(hint)}</p>` : ''}
        <div class="game-card-actions">
          <a class="btn" href="/#/login" target="_blank" rel="noopener">Войти на форуме ↗</a>
          <button class="btn" id="gameRetryBtn">Проверить снова</button>
        </div>
        <p class="game-hint muted">После входа на форуме игра продолжится автоматически (эта вкладка должна оставаться открытой).</p>
      </div>`;
    const btn = document.getElementById('gameRetryBtn');
    if (btn) btn.addEventListener('click', () => route());
    watchTokenUntil();
  }

  /** Лобби: список локаций (REST игры) */
  async function renderLobby() {
    stopTokenWatch();
    // уходим из мира: останавливаем сцену и соединение (при возврате будет новая сессия)
    if (window.GameWorld && GameWorld.isStarted()) {
      GameWorld.stop();
      GameNet.close();
    }
    const token = localStorage.getItem('mochi_token');
    if (!token) {
      loginCard('Чтобы играть, войдите на форум — игровой регистрации нет.');
      return;
    }
    let res;
    try {
      res = await fetch(`${CFG.GAME_API_BASE}/api/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      loginCard('Игровой сервер недоступен.', 'Проверьте, что он запущен: в dev — «npm run dev» в game-server/ (порт 3001), БД игры — в Docker (game-db).');
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 403) {
        loginCard(data.error || 'Аккаунт заблокирован', 'Доступ в игру закрыт: проверьте уведомления на форуме.');
      } else if (res.status === 401) {
        loginCard(
          data.error || 'Сессия недействительна, войдите на форум заново',
          'Если вы только что вошли и видите это — скорее всего, у форума и игрового сервера разные JWT_SECRET (в dev у обоих должно быть значение из server/.env, например «dev-secret-mochi-local»), либо токен просрочен. Перевойдите на форуме или перезапустите игру с тем же секретом.'
        );
      } else {
        loginCard(data.error || `Ошибка ${res.status}`);
      }
      return;
    }
    if (!data.user) {
      loginCard('Не удалось загрузить профиль');
      return;
    }
    const me = data.user;

    let locations = [];
    try {
      locations = (await fetch(`${CFG.GAME_API_BASE}/api/locations`).then((r) => r.json())).locations || [];
    } catch { /* лобби переживёт пустой список */ }
    app().innerHTML = `
      <div class="game-card">
        <h2>🍡 Игра «Хаб»</h2>
        <p>Привет, <b>${UI.esc(me.username)}</b>! Третья часть M-o-chi.com — онлайн-мир с кругляшками.</p>
        <div class="game-loc-list">
          ${locations.map((l) => `
            <a class="game-loc" href="#/game/world/${UI.esc(l.slug)}">
              <b>${UI.esc(l.name)}</b> <span class="muted">· ${UI.esc(l.slug)}</span>
            </a>`).join('')}
        </div>
        <p class="muted">Управление доступно в игре по кнопке Help.</p>
      </div>`;
  }

  /** Мир: контейнер Phaser + панель чата + оверлеи */
  function renderWorld(slug) {
    const clean = String(slug || 'hub').replace(/[^a-z0-9_-]/gi, '') || 'hub';
    if (!localStorage.getItem('mochi_token')) {
      loginCard('Чтобы играть, войдите на форум — игровой регистрации нет.');
      return;
    }
    stopTokenWatch();
    // сцена уже живёт (навигация между world-маршрутами) — просто пере-джойнимся
    if (GameWorld.isStarted()) {
      window.__gameLocation = clean;
      if (GameNet.connected) GameNet.send({ type: 'join', location: clean });
      return;
    }
    app().innerHTML = `
      <div id="gameCanvasWrap"></div>
      <div id="gameBubbles"></div>
      <div id="gameTransition" class="game-transition"><span>Переход…</span></div>
      <div id="gameHandHud" class="game-hand-hud" aria-label="Руки персонажа">
        <button class="game-hand-slot" type="button" data-hand="left" aria-label="Левая рука"><span>Л</span><img alt=""><small class="game-hand-item-name"></small></button>
        <button class="game-hand-slot" type="button" data-hand="right" aria-label="Правая рука"><span>П</span><img alt=""><small class="game-hand-item-name"></small></button>
      </div>
      <a class="game-exit" href="#/game">← Лобби</a>`;
    app().insertAdjacentHTML('beforeend', `
      <button class="game-help" id="gameHelpBtn" type="button" aria-haspopup="dialog">Help</button>
      <div class="game-help-overlay" id="gameHelpOverlay" hidden>
        <section class="game-help-dialog" role="dialog" aria-modal="true" aria-labelledby="gameHelpTitle">
          <button class="game-help-close" id="gameHelpClose" type="button" aria-label="Закрыть">×</button>
          <h2 id="gameHelpTitle">Управление</h2>
          <ul>
            <li><b>WASD / стрелки</b> — движение; при перетаскивании скорость ниже.</li>
            <li><b>Колесо мыши</b> — приближение и отдаление камеры.</li>
            <li><b>ЛКМ по предмету</b> — взять в руку; <b>Ctrl + ЛКМ</b> — тащить за собой.</li>
            <li><b>E</b> — взять ближайший предмет, отпустить тащимый предмет, использовать предмет в руке или войти в дверь.</li>
            <li><b>X</b> — сменить активную руку; <b>Q</b> — положить предмет; <b>Ctrl + Q</b> — бросить.</li>
            <li><b>Клик по свободному месту</b> — повернуть персонажа.</li>
          </ul>
        </section>
      </div>`);
    GameChat.mount(document.getElementById('app'));
    const helpOverlay = document.getElementById('gameHelpOverlay');
    const closeHelp = () => {
      helpOverlay.hidden = true;
      document.getElementById('gameHelpBtn').focus();
    };
    document.getElementById('gameHelpBtn').addEventListener('click', () => {
      helpOverlay.hidden = false;
      document.getElementById('gameHelpClose').focus();
    });
    document.getElementById('gameHelpClose').addEventListener('click', closeHelp);
    helpOverlay.addEventListener('click', (event) => {
      if (event.target === helpOverlay) closeHelp();
    });
    helpOverlay.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') closeHelp();
    });

    if (!window.Phaser) {
      app().insertAdjacentHTML('beforeend', '<div class="game-card">Phaser не загрузился — проверьте сеть/CDN.</div>');
      return;
    }

    if (!GameNet.connected) {
      GameNet.revive(); // сброс флага closing (например, после graceful shutdown сервера)
      GameNet.connect();
    }
    // сцена сама джойнится в локацию после auth_ok (см. world.js tryJoin)
    setTimeout(() => GameWorld.start(clean), 0);
  }

  /* ---------- статические обработчики net (регистрируются один раз) ---------- */
  GameNet.on('_no_token', () => {
    loginCard('Чтобы играть, войдите на форум — игровой регистрации нет.');
  });
  GameNet.on('_auth_failed', () => {
    UI.toast('Игровой сервер не принял сессию', 'error');
    loginCard(
      'Сессия недействительна, войдите на форум заново',
      'Если вы только что вошли и видите это — скорее всего, у форума и игрового сервера разные JWT_SECRET (в dev оба должны совпадать со значением из server/.env), либо токен просрочен. Перевойдите на форуме.'
    );
  });
  GameNet.on('join_ok', () => {
    const ov = document.getElementById('gameTransition');
    if (ov) ov.classList.remove('show'); // оверлей «Переход…» прячется после входа
  });

  function route() {
    const hash = location.hash || '#/game';
    const m = hash.match(/^#\/game\/world\/([a-z0-9_-]+)$/i);
    if (m) renderWorld(m[1]);
    else renderLobby();
  }

  window.addEventListener('hashchange', route);
  document.addEventListener('DOMContentLoaded', route);

  return { route };
})();
