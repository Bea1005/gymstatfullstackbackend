const express = require('express');
const router = express.Router();
const { register, login, refreshSession, logout, requestPasswordReset, verifyPasswordResetOtp, resetPassword } = require('../controllers/authControllers');
const { loginRateLimiter, passwordResetRateLimiter, refreshRateLimiter } = require('../config/rateLimit');
const { csrfProtection } = require('../config/authTokens');

// Dapat ganito:
router.post('/register', loginRateLimiter, register);
router.post('/login', loginRateLimiter, login);
router.post('/refresh', refreshRateLimiter, csrfProtection, refreshSession);
router.post('/logout', csrfProtection, logout);
router.post('/forgot-password/request', passwordResetRateLimiter, requestPasswordReset);
router.post('/forgot-password/verify', passwordResetRateLimiter, verifyPasswordResetOtp);
router.post('/forgot-password/reset', passwordResetRateLimiter, resetPassword);

module.exports = router;