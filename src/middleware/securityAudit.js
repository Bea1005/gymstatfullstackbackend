const SecurityLog = require('../models/SecurityLog');

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const getClientIp = (req) => {
  const forwarded = req.get('x-forwarded-for');
  return (forwarded ? forwarded.split(',')[0].trim() : req.ip || '').slice(0, 64);
};

const recordSecurityEvent = (event) => {
  const safeEvent = {
    timestamp: new Date(),
    level: event.level,
    action: String(event.action || '').slice(0, 80),
    userId: String(event.userId || '').slice(0, 120),
    role: String(event.role || '').slice(0, 40),
    identifier: String(event.identifier || '').slice(0, 120),
    resource: String(event.resource || '').split('?')[0].slice(0, 240),
    ipAddress: String(event.ipAddress || '').slice(0, 64),
    result: event.result,
    reason: String(event.reason || '').slice(0, 160)
  };

  return SecurityLog.create(safeEvent).catch(() => {
    console.error('Security log write failed');
  });
};

const auditSecurityEvents = (req, res, next) => {
  res.on('finish', () => {
    const statusCode = res.statusCode;
    const result = statusCode >= 200 && statusCode < 400 ? 'SUCCESS' : 'FAILURE';
    const resource = req.originalUrl || req.path;
    const ipAddress = getClientIp(req);
    const isLogin = req.method === 'POST' && /\/login\/?$/i.test(req.path);

    if (isLogin && statusCode >= 400) {
      void recordSecurityEvent({
        level: 'SECURITY',
        action: 'LOGIN_FAILED',
        identifier: req.body?.id || req.body?.username || '',
        resource: req.path,
        ipAddress,
        result: 'FAILURE',
        reason: statusCode === 429 ? 'rate_limited' : statusCode === 401 ? 'authentication_failed' : 'invalid_request'
      });
    }

    if (req.user?.role === 'admin' && MUTATING_METHODS.has(req.method)) {
      void recordSecurityEvent({
        level: result === 'SUCCESS' ? 'INFO' : 'SECURITY',
        action: `ADMIN_${req.method}`,
        userId: req.user._id || req.user.id,
        role: req.user.role,
        resource,
        ipAddress,
        result,
        reason: result === 'FAILURE' ? `http_${statusCode}` : ''
      });
    }
  });

  next();
};

module.exports = { auditSecurityEvents, recordSecurityEvent };
