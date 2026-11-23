/* API-клиент M-o-chi.com */
window.API = (() => {
  const TOKEN_KEY = 'mochi_token';

  const getToken = () => localStorage.getItem(TOKEN_KEY);
  const setToken = (t) => t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);

  async function request(path, { method = 'GET', body, form } = {}) {
    const headers = {};
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (!form) headers['Content-Type'] = 'application/json';

    let res;
    try {
      res = await fetch('/api' + path, {
        method,
        headers,
        body: form ? form : body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw Object.assign(new Error('Нет соединения с сервером'), { status: 0 });
    }

    let data = {};
    try { data = await res.json(); } catch { /* пустой ответ */ }

    if (!res.ok) {
      if (res.status === 401 && token && !path.startsWith('/auth/')) {
        setToken(null);
      }
      throw Object.assign(new Error(data.error || `Ошибка ${res.status}`), { status: res.status, data });
    }
    return data;
  }

  return {
    getToken, setToken,
    get: (p) => request(p),
    post: (p, body) => request(p, { method: 'POST', body }),
    put: (p, body) => request(p, { method: 'PUT', body }),
    patch: (p, body) => request(p, { method: 'PATCH', body }),
    del: (p) => request(p, { method: 'DELETE' }),
    upload: (p, formData) => request(p, { method: 'POST', form: formData }),
  };
})();