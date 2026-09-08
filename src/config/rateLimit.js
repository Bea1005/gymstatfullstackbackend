const { ipKeyGenerator, rateLimit } = require('express-rate-limit');

const parsePositiveInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const loginWindowMs = parsePositiveInteger(
  process.env.LOGIN_RATE_LIMIT_WINDOW_MS,
  15 * 60 * 1000
);
const loginMax = parsePositiveInteger(process.env.LOGIN_RATE_LIMIT_MAX, 10);
const apiWindowMs = parsePositiveInteger(
  process.env.API_RATE_LIMIT_WINDOW_MS,
  60 * 1000
);
const apiMax = parsePositiveInteger(process.env.API_RATE_LIMIT_MAX, 120);

const keyGenerator = (req) => {
  const userId = req.user?._id || req.user?.id;
  return userId ? `user:${String(userId)}` : ipKeyGenerator(req.ip);
};

const limiterOptions = (windowMs, limit) => ({
  windowMs,
  limit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many requests. Please try again later.'
    });
  }
});

const loginRateLimiter = rateLimit(limiterOptions(loginWindowMs, loginMax));
const apiRateLimiter = rateLimit(limiterOptions(apiWindowMs, apiMax));

module.exports = { apiRateLimiter, loginRateLimiter };
