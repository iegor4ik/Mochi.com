const express = require('express');
const { requireAuth, bearerToken } = require('../middleware/auth');
const { getProfile } = require('../utils/profile-cache');

const router = express.Router();

/** GET /api/me — профиль текущего игрока (ник + аватар с аккаунта форума) */
router.get('/', requireAuth, async (req, res) => {
  try {
    const user = await getProfile(req.userId, bearerToken(req));
    if (user.is_banned) {
      return res.status(403).json({ error: 'Аккаунт заблокирован', banned: true });
    }
    res.json({ user: { id: user.id, username: user.username, avatar: user.avatar, role: user.role } });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, ...(e.banned ? { banned: true } : {}) });
  }
});

module.exports = router;
