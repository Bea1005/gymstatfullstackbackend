const httpMocks = require('node-mocks-http');
const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');

jest.mock('jsonwebtoken');
jest.mock('../../src/models/User', () => ({
  findById: jest.fn(),
  findOne: jest.fn(),
}));

const ENV_VARIABLES = [
  'NODE_ENV',
  'AUTH_COOKIE_SITE_MODE',
  'AUTH_COOKIE_SECURE',
  'CORS_ALLOWED_ORIGINS',
  'CORS_ALLOWED_METHODS',
  'CORS_ALLOWED_HEADERS',
  'FRONTEND_URL',
];
const originalEnvironment = Object.fromEntries(
  ENV_VARIABLES.map((name) => [name, process.env[name]])
);

const loadWithEnvironment = (modulePath, environment) => {
  ENV_VARIABLES.forEach((name) => delete process.env[name]);
  Object.assign(process.env, environment);
  let loadedModule;
  jest.isolateModules(() => {
    loadedModule = require(modulePath);
  });
  return loadedModule;
};

afterEach(() => {
  ENV_VARIABLES.forEach((name) => {
    if (originalEnvironment[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnvironment[name];
  });
});

describe('production authentication security configuration', () => {
  it('uses Strict, HttpOnly, Secure cookies for same-site production', () => {
    const { setAuthenticationCookies } = loadWithEnvironment(
      '../../src/config/authTokens',
      { NODE_ENV: 'production', AUTH_COOKIE_SITE_MODE: 'same-site' }
    );
    const response = { cookie: jest.fn(), setHeader: jest.fn() };

    setAuthenticationCookies(response, 'access', 'refresh', 'csrf');

    expect(response.setHeader).toHaveBeenCalledWith('X-CSRF-Token', 'csrf');
    expect(response.cookie).toHaveBeenCalledTimes(3);
    response.cookie.mock.calls.forEach(([, , options]) => {
      expect(options.sameSite).toBe('strict');
      expect(options.secure).toBe(true);
    });
    expect(response.cookie.mock.calls[0][2].httpOnly).toBe(true);
    expect(response.cookie.mock.calls[1][2].httpOnly).toBe(true);
    expect(response.cookie.mock.calls[2][2].httpOnly).toBe(false);
  });

  it('uses None only with explicitly Secure cross-site cookies', () => {
    const { setAuthenticationCookies, IS_CROSS_SITE_COOKIE_MODE } = loadWithEnvironment(
      '../../src/config/authTokens',
      {
        NODE_ENV: 'production',
        AUTH_COOKIE_SITE_MODE: 'cross-site',
        AUTH_COOKIE_SECURE: 'true',
      }
    );
    const response = { cookie: jest.fn(), setHeader: jest.fn() };

    setAuthenticationCookies(response, 'access', 'refresh', 'csrf');

    expect(IS_CROSS_SITE_COOKIE_MODE).toBe(true);
    response.cookie.mock.calls.forEach(([, , options]) => {
      expect(options.sameSite).toBe('none');
      expect(options.secure).toBe(true);
    });
  });

  it('keeps role-scoped auth cookies independent and clears only the selected role', () => {
    const { setAuthenticationCookies, clearAuthenticationCookies } = loadWithEnvironment(
      '../../src/config/authTokens',
      {
        NODE_ENV: 'production',
        AUTH_COOKIE_SITE_MODE: 'cross-site',
        AUTH_COOKIE_SECURE: 'true',
      }
    );
    const response = {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
      setHeader: jest.fn(),
    };

    setAuthenticationCookies(response, 'admin-access', 'admin-refresh', 'admin-csrf', 'admin');
    setAuthenticationCookies(response, 'student-access', 'student-refresh', 'student-csrf', 'student');

    expect(response.cookie.mock.calls.map(([name]) => name)).toEqual([
      'accessToken_admin', 'refreshToken_admin', 'csrfToken_admin',
      'accessToken_student', 'refreshToken_student', 'csrfToken_student',
    ]);
    expect(response.cookie.mock.calls.every(([, , options]) => options.secure)).toBe(true);
    expect(response.cookie.mock.calls.filter(([name]) => name.startsWith('accessToken_') || name.startsWith('refreshToken_'))
      .every(([, , options]) => options.httpOnly)).toBe(true);

    clearAuthenticationCookies(response, 'admin');

    expect(response.clearCookie.mock.calls.map(([name]) => name)).toEqual([
      'accessToken_admin', 'accessToken',
      'refreshToken_admin', 'refreshToken',
      'csrfToken_admin', 'csrfToken',
    ]);
    expect(response.clearCookie.mock.calls).not.toContainEqual(expect.arrayContaining(['accessToken_student']));
  });

  it('requires explicit production site mode and Secure for None', () => {
    expect(() => loadWithEnvironment(
      '../../src/config/authTokens',
      { NODE_ENV: 'production' }
    )).toThrow('AUTH_COOKIE_SITE_MODE');

    expect(() => loadWithEnvironment(
      '../../src/config/authTokens',
      { NODE_ENV: 'production', AUTH_COOKIE_SITE_MODE: 'cross-site' }
    )).toThrow('AUTH_COOKIE_SECURE=true');
  });

  it('rejects unsafe requests without a matching CSRF token and permits safe methods', () => {
    const { csrfProtection } = loadWithEnvironment(
      '../../src/config/authTokens',
      { NODE_ENV: 'production', AUTH_COOKIE_SITE_MODE: 'same-site' }
    );
    const next = jest.fn();
    const unsafeRequest = httpMocks.createRequest({ method: 'POST' });
    const unsafeResponse = httpMocks.createResponse();

    csrfProtection(unsafeRequest, unsafeResponse, next);
    expect(unsafeResponse.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();

    const mismatchedRequest = httpMocks.createRequest({
      method: 'PUT',
      cookies: { csrfToken: 'cookie-token' },
      headers: { 'x-csrf-token': 'different-token' },
    });
    const mismatchedResponse = httpMocks.createResponse();
    csrfProtection(mismatchedRequest, mismatchedResponse, next);
    expect(mismatchedResponse.statusCode).toBe(403);

    const safeRequest = httpMocks.createRequest({ method: 'OPTIONS' });
    csrfProtection(safeRequest, httpMocks.createResponse(), next);

    const matchedRequest = httpMocks.createRequest({
      method: 'PATCH',
      cookies: { csrfToken: 'matching-token' },
      headers: { 'x-csrf-token': 'matching-token' },
    });
    csrfProtection(matchedRequest, httpMocks.createResponse(), next);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('does not accept another portal role CSRF cookie', () => {
    const { csrfProtection } = loadWithEnvironment(
      '../../src/config/authTokens',
      { NODE_ENV: 'production', AUTH_COOKIE_SITE_MODE: 'same-site' }
    );
    const req = httpMocks.createRequest({
      method: 'POST',
      headers: { 'x-portal-role': 'admin', 'x-csrf-token': 'student-csrf' },
      cookies: { csrfToken_admin: 'admin-csrf', csrfToken_student: 'student-csrf' },
    });
    const res = httpMocks.createResponse();
    const next = jest.fn();

    csrfProtection(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();

    req.headers['x-csrf-token'] = 'admin-csrf';
    csrfProtection(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('enforces CSRF at the shared auth gate for unsafe cookie-authenticated routes', async () => {
    const { protect } = loadWithEnvironment(
      '../../src/middleware/auth',
      {
        NODE_ENV: 'production',
        AUTH_COOKIE_SITE_MODE: 'cross-site',
        AUTH_COOKIE_SECURE: 'true',
      }
    );
    const req = httpMocks.createRequest({
      method: 'DELETE',
      cookies: { accessToken: 'signed-access-cookie' },
    });
    const res = httpMocks.createResponse();
    const next = jest.fn();

    await protect(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('recovers only the existing CSRF token in a non-cacheable response header', () => {
    const { recoverCsrfToken } = loadWithEnvironment(
      '../../src/config/authTokens',
      { NODE_ENV: 'production', AUTH_COOKIE_SITE_MODE: 'cross-site', AUTH_COOKIE_SECURE: 'true' }
    );
    const req = httpMocks.createRequest({
      method: 'GET',
      cookies: { csrfToken: 'existing-csrf-token' },
    });
    const res = httpMocks.createResponse();

    recoverCsrfToken(req, res);

    expect(res.statusCode).toBe(204);
    expect(res.getHeader('cache-control')).toBe('no-store');
    expect(res.getHeader('x-csrf-token')).toBe('existing-csrf-token');
    expect(res.getHeader('set-cookie')).toBeUndefined();
    expect(res._getData()).toBe('');
  });

  it('creates a secure-policy CSRF cookie when none exists', () => {
    const { recoverCsrfToken } = loadWithEnvironment(
      '../../src/config/authTokens',
      { NODE_ENV: 'production', AUTH_COOKIE_SITE_MODE: 'cross-site', AUTH_COOKIE_SECURE: 'true' }
    );
    const req = httpMocks.createRequest({ method: 'GET' });
    const res = {
      cookie: jest.fn(),
      setHeader: jest.fn(),
      status: jest.fn().mockReturnValue({ end: jest.fn() }),
    };

    recoverCsrfToken(req, res);

    const [cookieName, token, options] = res.cookie.mock.calls[0];
    expect(cookieName).toBe('csrfToken');
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(options).toEqual(expect.objectContaining({
      httpOnly: false,
      secure: true,
      sameSite: 'none',
      path: '/',
      maxAge: expect.any(Number),
    }));
    expect(res.setHeader).toHaveBeenCalledWith('X-CSRF-Token', token);
  });

  it('recovers a CSRF token in the requested role cookie', () => {
    const { recoverCsrfToken } = loadWithEnvironment(
      '../../src/config/authTokens',
      { NODE_ENV: 'production', AUTH_COOKIE_SITE_MODE: 'cross-site', AUTH_COOKIE_SECURE: 'true' }
    );
    const req = httpMocks.createRequest({
      method: 'GET',
      headers: { 'x-portal-role': 'coach' },
      cookies: { csrfToken: 'legacy-shared-csrf-token' },
    });
    const res = {
      cookie: jest.fn(),
      setHeader: jest.fn(),
      status: jest.fn().mockReturnValue({ end: jest.fn() }),
    };

    recoverCsrfToken(req, res);

    expect(res.cookie.mock.calls[0][0]).toBe('csrfToken_coach');
    expect(res.cookie.mock.calls[0][1]).not.toBe('legacy-shared-csrf-token');
    expect(res.setHeader).toHaveBeenCalledWith('X-CSRF-Token', res.cookie.mock.calls[0][1]);
  });

  it('mounts CSRF recovery as a readable, no-store auth route', async () => {
    const authRouter = loadWithEnvironment(
      '../../src/routes/authRoutes',
      { NODE_ENV: 'production', AUTH_COOKIE_SITE_MODE: 'cross-site', AUTH_COOKIE_SECURE: 'true' }
    );
    const app = express();
    app.use(cookieParser());
    app.use('/api/v1', authRouter);

    const response = await request(app)
      .get('/api/v1/csrf')
      .set('Cookie', 'csrfToken=existing-csrf-token');

    expect(response.status).toBe(204);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-csrf-token']).toBe('existing-csrf-token');
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('allows only exact configured HTTPS origins with credentialed production CORS', () => {
    const { corsOptions } = loadWithEnvironment(
      '../../src/config/cors',
      {
        NODE_ENV: 'production',
        CORS_ALLOWED_ORIGINS: 'https://frontend.example.com',
        FRONTEND_URL: 'https://unlisted.example.com',
      }
    );

    expect(corsOptions.credentials).toBe(true);
    expect(corsOptions.exposedHeaders).toContain('X-CSRF-Token');
    expect(corsOptions.allowedHeaders).toContain('X-Portal-Role');
    expect(corsOptions.methods).toEqual(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
    corsOptions.origin('https://frontend.example.com', (error, allowed) => {
      expect(error).toBeNull();
      expect(allowed).toBe(true);
    });
    corsOptions.origin('https://unlisted.example.com', (error) => {
      expect(error.code).toBe('CORS_NOT_ALLOWED');
    });
  });

  it('rejects wildcard, non-origin, and missing production CORS configuration', () => {
    expect(() => loadWithEnvironment(
      '../../src/config/cors',
      { NODE_ENV: 'production', CORS_ALLOWED_ORIGINS: '*' }
    )).toThrow('exact trusted HTTPS frontend origins');

    expect(() => loadWithEnvironment(
      '../../src/config/cors',
      { NODE_ENV: 'production', CORS_ALLOWED_ORIGINS: 'https://frontend.example.com/path' }
    )).toThrow('exact trusted HTTPS frontend origins');

    expect(() => loadWithEnvironment(
      '../../src/config/cors',
      { NODE_ENV: 'production', FRONTEND_URL: 'https://frontend.example.com' }
    )).toThrow('CORS_ALLOWED_ORIGINS');

    expect(() => loadWithEnvironment(
      '../../src/config/cors',
      {
        NODE_ENV: 'production',
        CORS_ALLOWED_ORIGINS: 'https://frontend.example.com',
        CORS_ALLOWED_METHODS: 'GET,POST',
      }
    )).toThrow('GET, OPTIONS, and all state-changing API methods');

    expect(() => loadWithEnvironment(
      '../../src/config/cors',
      {
        NODE_ENV: 'production',
        CORS_ALLOWED_ORIGINS: 'https://frontend.example.com',
        CORS_ALLOWED_METHODS: 'POST,PUT,PATCH,DELETE,OPTIONS',
      }
    )).toThrow('GET, OPTIONS, and all state-changing API methods');
  });
});