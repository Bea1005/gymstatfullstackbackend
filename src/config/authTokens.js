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
const configuredCookieSiteMode = process.env.AUTH_COOKIE_SITE_MODE;
const cookieSiteMode = configuredCookieSiteMode || (isProduction ? '' : 'same-site');

if (!['same-site', 'cross-site'].includes(cookieSiteMode)) {
  throw new Error('Production must set AUTH_COOKIE_SITE_MODE to same-site or cross-site');
}

if (cookieSiteMode === 'cross-site' && process.env.AUTH_COOKIE_SECURE !== 'true') {
  throw new Error('SameSite=None authentication cookies require AUTH_COOKIE_SECURE=true');
}

const cookieSecure = isProduction || process.env.AUTH_COOKIE_SECURE === 'true';
const sameSite = cookieSiteMode === 'cross-site' ? 'none' : 'lax';
const IS_CROSS_SITE_COOKIE_MODE = cookieSiteMode === 'cross-site';

const baseCookieOptions = {
  httpOnly: true,
  secure: cookieSecure,
  sameSite,
  path: COOKIE_PATH,
};

const AUTH_ROLES = new Set(['student', 'coach', 'admin', 'screener']);

const normalizePortalRole = (role) => {
  const normalizedRole = String(role || '').trim().toLowerCase();
  return AUTH_ROLES.has(normalizedRole) ? normalizedRole : '';
};

const getPortalRole = (req) => normalizePortalRole(
  req.get?.('x-portal-role') || req.headers?.['x-portal-role']
);

const getRoleCookieName = (cookieName, role) => {
  const normalizedRole = normalizePortalRole(role);
  return normalizedRole ? `${cookieName}_${normalizedRole}` : cookieName;
};

const getAuthCookie = (req, cookieName) => {
  const role = getPortalRole(req);
  const roleCookieName = getRoleCookieName(cookieName, role);
  const roleCookie = req.cookies?.[roleCookieName];
  if (roleCookie) return { name: roleCookieName, value: roleCookie };
  return { name: cookieName, value: req.cookies?.[cookieName] || '' };
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

const setAuthenticationCookies = (res, accessToken, refreshToken, csrfToken, role) => {
  const accessCookieName = getRoleCookieName(ACCESS_COOKIE_NAME, role);
  const refreshCookieName = getRoleCookieName(REFRESH_COOKIE_NAME, role);
  const csrfCookieName = getRoleCookieName(CSRF_COOKIE_NAME, role);
  res.setHeader('X-CSRF-Token', csrfToken);
  res.cookie(accessCookieName, accessToken, {
    ...baseCookieOptions,
    maxAge: ACCESS_TOKEN_MAX_AGE_MS,
  });
  res.cookie(refreshCookieName, refreshToken, {
    ...baseCookieOptions,
    maxAge: REFRESH_TOKEN_TTL_MS,
  });
  res.cookie(csrfCookieName, csrfToken, {
    httpOnly: false,
    secure: cookieSecure,
    sameSite,
    path: COOKIE_PATH,
    maxAge: REFRESH_TOKEN_TTL_MS,
  });
};

const clearAuthenticationCookies = (res, role) => {
  const accessCookieNames = new Set([getRoleCookieName(ACCESS_COOKIE_NAME, role), ACCESS_COOKIE_NAME]);
  const refreshCookieNames = new Set([getRoleCookieName(REFRESH_COOKIE_NAME, role), REFRESH_COOKIE_NAME]);
  const csrfCookieNames = new Set([getRoleCookieName(CSRF_COOKIE_NAME, role), CSRF_COOKIE_NAME]);
  accessCookieNames.forEach((cookieName) => res.clearCookie(cookieName, baseCookieOptions));
  refreshCookieNames.forEach((cookieName) => res.clearCookie(cookieName, baseCookieOptions));
  csrfCookieNames.forEach((cookieName) => res.clearCookie(cookieName, {
    httpOnly: false,
    secure: cookieSecure,
    sameSite,
    path: COOKIE_PATH,
  }));
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

const isCsrfTokenValid = (req) => {
  const cookieToken = getAuthCookie(req, CSRF_COOKIE_NAME).value;
  const headerToken = req.get('x-csrf-token');
  const cookieBuffer = Buffer.from(String(cookieToken || ''));
  const headerBuffer = Buffer.from(String(headerToken || ''));

  return Boolean(cookieToken && headerToken && cookieBuffer.length === headerBuffer.length
    && crypto.timingSafeEqual(cookieBuffer, headerBuffer));
};

const recoverCsrfToken = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const role = getPortalRole(req);
  const roleCookieName = getRoleCookieName(CSRF_COOKIE_NAME, role);
  const roleCookie = req.cookies?.[roleCookieName];
  const legacyCookie = req.cookies?.[CSRF_COOKIE_NAME];
  const csrfToken = roleCookie || (!role && legacyCookie) || crypto.randomBytes(32).toString('base64url');
  if (!roleCookie && (role || !legacyCookie)) {
    res.cookie(roleCookieName, csrfToken, {
      httpOnly: false,
      secure: cookieSecure,
      sameSite,
      path: COOKIE_PATH,
      maxAge: REFRESH_TOKEN_TTL_MS,
    });
  }
  res.setHeader('X-CSRF-Token', csrfToken);
  return res.status(204).end();
};

const csrfProtection = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || '').toUpperCase())) {
    return next();
  }

  if (!isCsrfTokenValid(req)) {
    return res.status(403).json({ success: false, message: 'Request could not be verified.' });
  }

  return next();
};

module.exports = {
  normalizePortalRole,
  getPortalRole,
  getRoleCookieName,
  getAuthCookie,
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  IS_CROSS_SITE_COOKIE_MODE,
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL_MS,
  createAccessToken,
  createRefreshSession,
  hashRefreshToken,
  setAuthenticationCookies,
  clearAuthenticationCookies,
  isCsrfTokenValid,
  recoverCsrfToken,
  csrfProtection,
};
