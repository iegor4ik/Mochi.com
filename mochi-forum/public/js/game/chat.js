/**
 * Игровой чат «Хаба»: HTML-панель (список + инпут) поверх канваса и пузыри
 * над персонажами. Разметка панели — отдельный блок #gameChatPanel.
 * Ники в логе/пузырях НЕ дублируются — ник всегда отображается над персонажем;
 * вместо имени строки окрашиваются в цвет игрока. Системные сообщения — серые.
 * Весь пользовательский текст — через textContent/UI.esc() (XSS).
 */
window.GameChat = (() => {
  const BUBBLE_MS = 6000; // пузырь живёт ~6 с (ТЗ §7)
  let panel = null;
  let listEl = null;
  let inputEl = null;
  const bubbles = new Map(); // userId → { el, timer }

  /** Создать панель чата (вызывается один раз из router.js) */
  function mount(container) {
    panel = document.createElement('div');
    panel.id = 'gameChatPanel';
    panel.innerHTML = `
      <div class="gchat-head">💬 Чат <span class="gchat-loc" id="gchatLoc"></span></div>
      <div class="gchat-list" id="gchatList"></div>
      <div class="gchat-input-row">
        <input type="text" id="gchatInput" maxlength="300" placeholder="Сообщение... (Enter)" autocomplete="off">
      </div>`;
    container.appendChild(panel);
    listEl = panel.querySelector('#gchatList');
    inputEl = panel.querySelector('#gchatInput');

    inputEl.addEventListener('keydown', (e) => {
      e.stopPropagation(); // WASD не должны печатать в инпуте
      if (e.key === 'Enter') {
        const text = inputEl.value.trim();
        if (text) {
          window.GameNet.send({ type: 'chat', text });
          inputEl.value = '';
        }
        inputEl.blur(); // фокус возвращается игре — WASD снова двигают персонажа
      } else if (e.key === 'Escape') {
        inputEl.blur();
      }
    });
    // фокус: клик по панели не должен двигать персонажа
    panel.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  /** Заголовок: имя текущей локации */
  function setLocation(name) {
    const el = document.getElementById('gchatLoc');
    if (el) el.textContent = `· ${name}`;
  }

  /** Добавить строку в панель: только текст, окрашенный в цвет игрока */
  function addLine(text, { color = null, muted = false } = {}) {
    if (!listEl) return;
    const row = document.createElement('div');
    row.className = 'gchat-row' + (muted ? ' muted' : '');
    const span = document.createElement('span');
    if (color) span.style.color = color;
    span.textContent = text; // textContent — XSS-безопасно без экранирования
    row.appendChild(span);
    listEl.appendChild(row);
    while (listEl.children.length > 50) listEl.firstChild.remove(); // лимит DOM
    listEl.scrollTop = listEl.scrollHeight;
  }

  /** История при входе (join_ok.chatHistory): user_id → цвет строки */
  function renderHistory(history) {
    if (!listEl) return;
    listEl.innerHTML = '';
    (history || []).forEach((m) => {
      addLine(m.text, { muted: true, color: GameCharacter.colorOf(m.user_id) });
    });
  }

  /** Пузырь над персонажем: только текст (ник и так над головой 24/7) */
  function showBubble(world, userId, text) {
    hideBubble(userId);
    const el = document.createElement('div');
    el.className = 'game-bubble';
    el.textContent = text;
    document.getElementById('gameBubbles').appendChild(el);
    const timer = setTimeout(() => hideBubble(userId), BUBBLE_MS);
    bubbles.set(userId, { el, timer });
    positionBubble(world, userId);
  }

  function hideBubble(userId) {
    const b = bubbles.get(userId);
    if (!b) return;
    clearTimeout(b.timer);
    b.el.remove();
    bubbles.delete(userId);
  }

  /** Пересчёт позиции пузырей по координатам камеры (вызывается из world.js на update) */
  function updatePositions(world) {
    for (const [userId] of bubbles) positionBubble(world, userId);
  }

  function positionBubble(world, userId) {
    const b = bubbles.get(userId);
    if (!b) return;
    const p = world.getPlayerScreenPos(userId);
    if (!p) { hideBubble(userId); return; }
    b.el.style.left = `${p.x}px`;
    b.el.style.top = `${p.y}px`;
  }

  return { mount, setLocation, addLine, renderHistory, showBubble, hideBubble, updatePositions };
})();
