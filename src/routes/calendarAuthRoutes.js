const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  loginRateLimiter,
  registrationVerificationRateLimiter,
} = require('../config/rateLimit');
const {
  register,
  verifyRegistration,
  resendVerification,
  login,
  googleLogin,
  getSession,
  completeProfile,
} = require('../controllers/calendarAuthController');

router.post('/register', loginRateLimiter, register);
router.post('/register/verify', registrationVerificationRateLimiter, verifyRegistration);
router.post('/register/resend', registrationVerificationRateLimiter, resendVerification);
router.post('/login', loginRateLimiter, login);
router.post('/google', loginRateLimiter, googleLogin);
router.get('/session', protect, getSession);
router.post('/profile', protect, completeProfile);

module.exports = router;
