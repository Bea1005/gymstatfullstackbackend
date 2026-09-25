const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { getJWTSecret } = require('./security');
const RefreshSession = require('../models/RefreshSession');

const parsePositiveInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL || '10m';
const ACCESS_TOKEN_MAX_AGE_MS = parsePositiveInteger(
  process.env.ACCESS_TOKEN_MAX_AGE_MS,
  10 * 60 * 1000
);
const REFRESH_TOKEN_TTL_MS = parsePositiveInteger(
  process.env.REFRESH_TOKEN_TTL_MS,
  30 * 24 * 60 * 60 * 1000
);
const ACCESS_COOKIE_NAME = process.env.ACCESS_COOKIE_NAME || 'accessToken';
const REFRESH_COOKIE_NAME = process.env.REFRESH_COOKIE_NAME || 'refreshToken';
const CSRF_COOKIE_NAME = process.env.CSRF_COOKIE_NAME || 'csrfToken';
const COOKIE_PATH = process.env.AUTH_COOKIE_PATH || '/';
const isProduction = process.env.NODE_ENV === 'production';
const cookieSecure = isProduction || process.env.AUTH_COOKIE_SECURE === 'true';
const sameSite = process.env.AUTH_COOKIE_SAME_SITE || (isProduction ? 'strict' : 'lax');

const baseCookieOptions = {
  httpOnly: true,
  secure: cookieSecure,
  sameSite,
  path: COOKIE_PATH,
};

const hashRefreshToken = (token) => crypto
  .createHash('sha256')
  .update(String(token))
  .digest('hex');

const createAccessToken = (user) => jwt.sign(
  {
    id: user._id,
    userId: user._id,
    role: user.role,
    email: user.email || '',
  },
  getJWTSecret(),
  { expiresIn: ACCESS_TOKEN_TTL }
);

const setAuthenticationCookies = (res, accessToken, refreshToken, csrfToken) => {
  res.cookie(ACCESS_COOKIE_NAME, accessToken, {
    ...baseCookieOptions,
    maxAge: ACCESS_TOKEN_MAX_AGE_MS,
  });
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    ...baseCookieOptions,
    maxAge: REFRESH_TOKEN_TTL_MS,
  });
  res.cookie(CSRF_COOKIE_NAME, csrfToken, {
    httpOnly: false,
    secure: cookieSecure,
    sameSite,
    path: COOKIE_PATH,
    maxAge: REFRESH_TOKEN_TTL_MS,
  });
};

const clearAuthenticationCookies = (res) => {
  res.clearCookie(ACCESS_COOKIE_NAME, baseCookieOptions);
  res.clearCookie(REFRESH_COOKIE_NAME, baseCookieOptions);
  res.clearCookie(CSRF_COOKIE_NAME, {
    httpOnly: false,
    secure: cookieSecure,
    sameSite,
    path: COOKIE_PATH,
  });
};

const createRefreshSession = async (userId, familyId = crypto.randomUUID()) => {
  const refreshToken = crypto.randomBytes(64).toString('base64url');
  const tokenHash = hashRefreshToken(refreshToken);
  await RefreshSession.create({
    userId,
    tokenHash,
    familyId,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  });
  return { refreshToken, tokenHash, familyId };
};

const csrfProtection = (req, res, next) => {
  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = req.get('x-csrf-token');
  const cookieBuffer = Buffer.from(String(cookieToken || ''));
  const headerBuffer = Buffer.from(String(headerToken || ''));

  if (!cookieToken || !headerToken || cookieBuffer.length !== headerBuffer.length
    || !crypto.timingSafeEqual(cookieBuffer, headerBuffer)) {
    return res.status(403).json({ success: false, message: 'Request could not be verified.' });
  }

  return next();
};

module.exports = {
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL_MS,
  createAccessToken,
  createRefreshSession,
  hashRefreshToken,
  setAuthenticationCookies,
  clearAuthenticationCookies,
  csrfProtection,
};
