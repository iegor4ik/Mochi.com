/** Класс API-ошибок с HTTP-статусом (копия паттерна основного сервера) */
class ApiError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const bad = (msg, extra) => new ApiError(400, msg, extra);
const notFound = (msg = 'Не найдено') => new ApiError(404, msg);
const forbidden = (msg = 'Недостаточно прав', extra) => new ApiError(403, msg, extra);
const unauthorized = (msg = 'Требуется авторизация') => new ApiError(401, msg);

/** Обёртка для асинхронных обработчиков */
const asyncH = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { ApiError, bad, notFound, forbidden, unauthorized, asyncH };
