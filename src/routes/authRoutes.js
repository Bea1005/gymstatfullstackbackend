const express = require('express');
const router = express.Router();
const { register, login, requestPasswordReset, verifyPasswordResetOtp, resetPassword } = require('../controllers/authControllers');
const { loginRateLimiter, passwordResetRateLimiter } = require('../config/rateLimit');

// Dapat ganito:
router.post('/register', loginRateLimiter, register);
router.post('/login', loginRateLimiter, login);
router.post('/forgot-password/request', passwordResetRateLimiter, requestPasswordReset);
router.post('/forgot-password/verify', passwordResetRateLimiter, verifyPasswordResetOtp);
router.post('/forgot-password/reset', passwordResetRateLimiter, resetPassword);

module.exports = router;