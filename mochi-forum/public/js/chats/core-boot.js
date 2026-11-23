/* Загрузка Mochi chats */
(async () => {
  Chats.applyTheme();
  await Chats.refreshUser();
  Chats.renderHeader();

  // бургер-меню
  document.getElementById('chatsBurger').addEventListener('click', () => {
    document.getElementById('chatsMobileMenu').classList.toggle('open');
  });

  window.addEventListener('hashchange', Chats.route);
  await Chats.route();

  setInterval(() => Chats.pollBadge(), 20000);
  Chats.pollBadge();
})();
