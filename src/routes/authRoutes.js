const express = require('express');
const router = express.Router();
const { register, login, forgotPassword } = require('../controllers/authControllers');
const { loginRateLimiter } = require('../config/rateLimit');

// Dapat ganito:
router.post('/register', loginRateLimiter, register);
router.post('/login', loginRateLimiter, login);
router.post('/forgot-password', loginRateLimiter, forgotPassword);

module.exports = router;