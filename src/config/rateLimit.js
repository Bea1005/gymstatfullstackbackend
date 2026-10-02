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
const coachApiMax = parsePositiveInteger(process.env.COACH_API_RATE_LIMIT_MAX, 300);
const scheduleRequestWindowMs = parsePositiveInteger(
  process.env.SCHEDULE_REQUEST_RATE_LIMIT_WINDOW_MS,
  15 * 60 * 1000
);
const scheduleRequestMax = parsePositiveInteger(
  process.env.SCHEDULE_REQUEST_RATE_LIMIT_MAX,
  5
);
const refreshRateLimitWindowMs = parsePositiveInteger(
  process.env.REFRESH_RATE_LIMIT_WINDOW_MS,
  60 * 1000
);
const refreshRateLimitMax = parsePositiveInteger(
  process.env.REFRESH_RATE_LIMIT_MAX,
  30
);

const keyGenerator = (req) => {
  const userId = req.user?._id || req.user?.id;
  return userId ? `user:${String(userId)}` : ipKeyGenerator(req.ip);
};

const getCoachApiRateLimitKey = (req) => {
  const userId = req.user?._id || req.user?.id;
  const routeGroup = String(req.path || '/')
    .split('?')[0]
    .split('/')
    .filter(Boolean)
    .slice(0, 2)
    .join(':') || 'root';
  const identity = userId ? `user:${String(userId)}` : `ip:${ipKeyGenerator(req.ip)}`;
  return `coach:${identity}:${String(req.method || 'GET').toUpperCase()}:${routeGroup}`;
};

const limiterOptions = (windowMs, limit, generateKey = keyGenerator) => ({
  windowMs,
  limit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: generateKey,
  handler: (_req, res) => {
    res.setHeader('Retry-After', String(Math.ceil(windowMs / 1000)));
    res.status(429).json({
      success: false,
      message: 'Too many requests. Please try again later.'
    });
  }
});

const publicIpLimiterOptions = (windowMs, limit) => ({
  windowMs,
  limit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `public-ip:${ipKeyGenerator(req.ip)}`,
  handler: (_req, res) => {
    res.setHeader('Retry-After', String(Math.ceil(windowMs / 1000)));
    res.status(429).json({
      success: false,
      message: 'Too many requests. Please try again later.'
    });
  }
});

const loginRateLimiter = rateLimit(limiterOptions(loginWindowMs, loginMax));
const apiRateLimiter = rateLimit(limiterOptions(apiWindowMs, apiMax));
const coachApiRateLimiter = rateLimit(limiterOptions(apiWindowMs, coachApiMax, getCoachApiRateLimitKey));
const passwordResetRateLimiter = rateLimit(limiterOptions(
  parsePositiveInteger(process.env.PASSWORD_RESET_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  parsePositiveInteger(process.env.PASSWORD_RESET_RATE_LIMIT_MAX, 5)
));
const scheduleRequestRateLimiter = rateLimit(publicIpLimiterOptions(
  scheduleRequestWindowMs,
  scheduleRequestMax
));
const refreshRateLimiter = rateLimit(publicIpLimiterOptions(
  refreshRateLimitWindowMs,
  refreshRateLimitMax
));

module.exports = {
  apiRateLimiter,
  coachApiRateLimiter,
  loginRateLimiter,
  passwordResetRateLimiter,
  scheduleRequestRateLimiter,
  refreshRateLimiter,
  getCoachApiRateLimitKey,
};
