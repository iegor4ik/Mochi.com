/**
 * Утилиты постов профиля: allowlist-санитайзер HTML, нормализация
 * шрифтов/тегов/URL и извлечение текстового фрагмента для лент.
 *
 * Редактор на фронте (contenteditable) присылает произвольный HTML —
 * перед сохранением он проходит строгую фильтрацию: остаются только
 * разрешённые теги, атрибуты и inline-стили, весь текст экранируется.
 */

const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr', 'b', 'strong', 'i', 'em', 'u', 's', 'del', 'ins',
  'h1', 'h2', 'h3', 'h4', 'blockquote', 'ul', 'ol', 'li',
  'a', 'img', 'span', 'div', 'figure', 'figcaption', 'pre', 'code',
  'small', 'sub', 'sup', 'mark',
]);

/** Опасные контейнеры — вырезаются вместе с содержимым */
const DROP_CONTENT = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'form', 'button', 'input',
  'select', 'textarea', 'svg', 'math', 'noscript', 'template', 'title', 'head',
  'applet', 'frame', 'frameset', 'audio', 'video', 'canvas', 'base',
]);

/** Void-теги вне allowlist — вырезается только сам тег */
const DROP_VOID = new Set(['meta', 'link', 'area', 'source', 'track', 'wbr', 'param', 'col']);

const VOID_TAGS = new Set(['br', 'hr', 'img']);

/** Разрешённые CSS-свойства для inline-стилей */
const STYLE_PROPS = new Set([
  'font-size', 'font-family', 'font-weight', 'font-style', 'font-variant',
  'color', 'background-color', 'text-align', 'text-decoration', 'text-transform',
  'line-height', 'letter-spacing', 'margin-left', 'margin-right',
  'padding-left', 'padding-right',
]);

const escText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Простой парсер атрибутов открывающего тега (учитывает кавычки) */
function parseAttrs(s) {
  const attrs = {};
  let k = 0;
  while (k < s.length) {
    while (k < s.length && /\s/.test(s[k])) k++;
    if (k >= s.length) break;
    let name = '';
    while (k < s.length && /[^\s=]/.test(s[k])) { name += s[k]; k++; }
    name = name.toLowerCase().replace(/\/+$/, '');
    if (!name) { k++; continue; }
    while (k < s.length && /\s/.test(s[k])) k++;
    let val = '';
    if (s[k] === '=') {
      k++;
      while (k < s.length && /\s/.test(s[k])) k++;
      if (s[k] === '"' || s[k] === "'") {
        const q = s[k++];
        while (k < s.length && s[k] !== q) { val += s[k]; k++; }
        k++;
      } else {
        while (k < s.length && !/\s/.test(s[k])) { val += s[k]; k++; }
      }
    }
    if (name && attrs[name] === undefined) attrs[name] = val;
  }
  return attrs;
}

/** Фильтр inline-стилей: только безопасные свойства и значения */
function sanitizeCss(styleStr) {
  return String(styleStr || '')
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .filter((d) => {
      const idx = d.indexOf(':');
      if (idx <= 0) return false;
      const prop = d.slice(0, idx).trim().toLowerCase();
      const val = d.slice(idx + 1).trim();
      return STYLE_PROPS.has(prop)
        && !/[;{}@]/.test(val)
        && !/(url\(|expression|javascript|behavior|import)/i.test(val);
    })
    .map((d) => d.replace(/\s*:\s*/, ': '))
    .join('; ');
}

/** Безопасные URL: относительные /uploads/… и http(s):// (+inline-картинки) */
function sanitizeUrl(raw) {
  const u = String(raw || '').trim().replace(/["'\\\s]+/g, '');
  if (!u) return null;
  if (/^\/uploads\//i.test(u)) return u.slice(0, 600);
  if (/^https?:\/\/[^\s<>"']+$/i.test(u)) return u.slice(0, 600);
  if (/^data:image\/(png|gif|jpe?g|webp);base64,[a-z0-9+/=]+$/i.test(u)) return u.slice(0, 300000);
  return null;
}

/**
 * Главная функция: возвращает безопасный HTML.
 * Незакрытые теги дозакрываются, «лишние» закрывающие — выбрасываются.
 */
function sanitizePostHtml(html) {
  const src = String(html || '');
  const LIMIT = 300000;
  let out = '';
  const stack = [];      // открытые разрешённые теги
  const dropStack = [];  // контекст опасных контейнеров (содержимое выкидываем)

  const pushClose = (tag) => {
    const idx = stack.lastIndexOf(tag);
    if (idx === -1) return;
    for (let k = stack.length - 1; k >= idx; k--) out += `</${stack[k]}>`;
    stack.length = idx;
  };

  let i = 0;
  const n = src.length;
  while (i < n && out.length < LIMIT) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      if (!dropStack.length) out += escText(src.slice(i));
      break;
    }
    if (lt > i && !dropStack.length) out += escText(src.slice(i, lt));

    // комментарии
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    // doctype / инструкции <?
    if (src[lt + 1] === '!' || src[lt + 1] === '?') {
      const end = src.indexOf('>', lt);
      i = end === -1 ? n : end + 1;
      continue;
    }
    // закрывающий тег
    if (src[lt + 1] === '/') {
      const end = src.indexOf('>', lt);
      if (end === -1) break;
      const tag = src.slice(lt + 2, end).trim().toLowerCase().split(/\s+/)[0];
      if (dropStack.length) {
        if (tag === dropStack[dropStack.length - 1]) dropStack.pop();
      } else if (ALLOWED_TAGS.has(tag)) {
        pushClose(tag);
      }
      i = end + 1;
      continue;
    }

    // открывающий тег
    const nameMatch = /^<([a-zA-Z][a-zA-Z0-9]*)/.exec(src.slice(lt, lt + 30));
    if (!nameMatch) { // «<» как текст
      if (!dropStack.length) out += '&lt;';
      i = lt + 1;
      continue;
    }
    const tag = nameMatch[1].toLowerCase();

    // ищем конец тега с учётом кавычек в атрибутах
    let j = lt + nameMatch[0].length;
    let quote = null;
    while (j < n) {
      const ch = src[j];
      if (quote) { if (ch === quote) quote = null; }
      else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '>') break;
      j++;
    }
    if (j >= n) break; // обрезанный тег — игнорируем хвост
    const attrSrc = src.slice(lt + nameMatch[0].length, j);
    const selfClosed = /\/\s*$/.test(attrSrc.trim());
    const attrs = parseAttrs(attrSrc);
    i = j + 1;

    if (DROP_CONTENT.has(tag)) {
      if (!selfClosed) dropStack.push(tag);
      continue;
    }
    if (DROP_VOID.has(tag)) continue;
    if (!ALLOWED_TAGS.has(tag)) continue; // вырезаем тег, содержимое остаётся
    if (dropStack.length) continue;

    let attrOut = '';
    if (tag === 'a') {
      const href = sanitizeUrl(attrs.href);
      if (href) attrOut += ` href="${escText(href)}" target="_blank" rel="noopener noreferrer nofollow"`;
    }
    if (tag === 'img') {
      const imgUrl = sanitizeUrl(attrs.src);
      if (!imgUrl) continue; // img без валидного src не пропускаем
      attrOut += ` src="${escText(imgUrl)}" alt="" loading="lazy"`;
    }
    if (attrs.style) {
      const css = sanitizeCss(attrs.style);
      if (css) attrOut += ` style="${escText(css)}"`;
    }

    if (VOID_TAGS.has(tag)) { out += `<${tag}${attrOut}>`; continue; }
    out += `<${tag}${attrOut}>`;
    stack.push(tag);
  }

  while (stack.length) out += `</${stack.pop()}>`;
  return out.slice(0, LIMIT);
}

/** Массив загруженных шрифтов: [{name, url}] — максимум 5, url только /uploads/fonts/ */
function sanitizeFonts(fonts) {
  if (!Array.isArray(fonts)) return [];
  const out = [];
  const seen = new Set();
  for (const f of fonts) {
    if (!f || typeof f !== 'object' || out.length >= 5) break;
    const name = String(f.name || '').replace(/[<>"'\\/]/g, '').trim().slice(0, 48);
    const url = String(f.url || '');
    if (!name || !/^\/uploads\/fonts\/[A-Za-z0-9._-]+$/.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ name, url });
  }
  return out;
}

/** Теги: строки → нормализованный уникальный массив (макс. 10 по 32 символа) */
function sanitizeTags(tags) {
  if (!Array.isArray(tags)) {
    if (typeof tags === 'string') tags = tags.split(/[,\s]+/);
    else return [];
  }
  const out = [];
  const seen = new Set();
  for (let t of tags) {
    if (typeof t !== 'string') continue;
    t = t.trim().replace(/^#+/, '').toLowerCase();
    t = t.replace(/[^\wа-яё-]/gi, '');
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t.slice(0, 32));
    if (out.length >= 10) break;
  }
  return out;
}

/** URL картинки (обложка): только /uploads/… или http(s):// */
function sanitizeImageUrl(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const u = sanitizeUrl(raw);
  if (!u || /^data:/i.test(u)) return null;
  return u;
}

/** Текстовый фрагмент из HTML (для превью в лентах) */
function excerptFromHtml(html, max = 220) {
  const text = String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? text.slice(0, max).trimEnd() + '…' : text;
}

/** Контент поста целиком: {html, fonts} */
function sanitizePostContent(content) {
  const c = content && typeof content === 'object' ? content : {};
  return {
    html: sanitizePostHtml(c.html || ''),
    fonts: sanitizeFonts(c.fonts || []),
  };
}

module.exports = {
  sanitizePostHtml, sanitizePostContent, sanitizeFonts, sanitizeTags,
  sanitizeImageUrl, excerptFromHtml,
};