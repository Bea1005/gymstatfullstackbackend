const express = require('express');
const router = express.Router();
const {
  register,
  verifyRegistrationOtp,
  resendRegistrationOtp,
  login,
  refreshSession,
  logout,
  requestPasswordReset,
  verifyPasswordResetOtp,
  resetPassword
} = require('../controllers/authControllers');
const {
  loginRateLimiter,
  passwordResetRateLimiter,
  registrationVerificationRateLimiter,
  refreshRateLimiter
} = require('../config/rateLimit');
const { csrfProtection, recoverCsrfToken } = require('../config/authTokens');

// Dapat ganito:
router.get('/csrf', recoverCsrfToken);
router.post('/register', loginRateLimiter, register);
router.post('/register/verify', registrationVerificationRateLimiter, verifyRegistrationOtp);
router.post('/register/resend', registrationVerificationRateLimiter, resendRegistrationOtp);
router.post('/login', loginRateLimiter, login);
router.post('/refresh', refreshRateLimiter, csrfProtection, refreshSession);
router.post('/logout', csrfProtection, logout);
router.post('/forgot-password/request', passwordResetRateLimiter, requestPasswordReset);
router.post('/forgot-password/verify', passwordResetRateLimiter, verifyPasswordResetOtp);
router.post('/forgot-password/reset', passwordResetRateLimiter, resetPassword);

module.exports = router;