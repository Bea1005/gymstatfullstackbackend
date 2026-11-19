const SecurityLog = require('../models/SecurityLog');
const RefreshSession = require('../models/RefreshSession');
const User = require('../models/User');
const {
  hashRefreshToken,
  getPortalRole,
  getRoleCookieName,
  REFRESH_COOKIE_NAME
} = require('../config/authTokens');

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const AUDIT_ATTACHED = Symbol.for('gymstat.audit.attached');
const SENSITIVE_FIELD = /password|otp|token|secret|credential|authorization|cookie|email|phone|contact|key/i;
const IMPORTANT_VIEW_PATHS = [
  /\/admin\/dashboard(?:\/|$)/i,
  /\/users(?:\/|$)/i,
  /\/coach\/(?:athletes|requirements|student-directory)(?:\/|$)/i,
  /\/screener\/requirements(?:\/|$)/i,
  /\/requirements\/admin\/submissions(?:\/|$)/i,
  /\/requirements\/(?:my\/submissions|published)(?:\/|$)/i,
  /\/schedule-requests(?:\/|$)/i,
  /\/schedules(?:\/|$)/i,
  /\/admin\/(?:equipment|borrowing)(?:\/|$)/i,
  /\/profile(?:\/|$)/i,
  /\/requirements\/[^/]+\/download(?:\/|$)/i,
  /\/student\/requirements(?:\/|$)/i
];

const getClientIp = (req) => {
  const forwarded = req.get('x-forwarded-for');
  return (forwarded ? forwarded.split(',')[0].trim() : req.ip || '').slice(0, 64);
};

const getRequestPath = (req) => String(req.originalUrl || req.path || '')
  .split('?')[0]
  .slice(0, 240);

const getModule = (path) => {
  if (/\/calendar-auth\//i.test(path)) return 'Public Calendar';
  if (/\/(?:login|logout|register)(?:\/|$)/i.test(path)) return 'Authentication';
  if (/\/admin\/audit-logs(?:\/|$)/i.test(path)) return 'Audit Log';
  if (/\/admin\/dashboard(?:\/|$)/i.test(path)) return 'Admin Dashboard';
  if (/\/users(?:\/|$)/i.test(path)) return 'User Management';
  if (/\/coach\/.*\/requirements/i.test(path)) return 'Coach Requirements';
  if (/\/admin\/equipment|\/equipment\/admin/i.test(path)) return 'Equipment';
  if (/\/admin\/borrowing/i.test(path)) return 'Borrowing';
  if (/\/schedule-requests/i.test(path)) return 'Schedule Requests';
  if (/\/schedules/i.test(path)) return 'Schedules';
  if (/\/coach\/requirements/i.test(path)) return 'Coach Requirements';
  if (/\/screener\/requirements/i.test(path)) return 'Screener Review';
  if (/\/coach\//i.test(path)) return 'Coach Portal';
  if (/\/student\/requirements/i.test(path)) return 'Student Requirements';
  if (/\/requirements/i.test(path)) return 'Requirements';
  if (/\/student\//i.test(path)) return 'Student Portal';
  if (/\/screener\//i.test(path)) return 'Screener Portal';
  if (/\/profile/i.test(path)) return 'Account Profile';
  if (/\/admin\//i.test(path)) return 'Admin Portal';
  return 'GYMSTAT';
};

const getAction = (method, path, result) => {
  const lowerPath = path.toLowerCase();
  if (/\/login(?:\/|$)/.test(lowerPath)) return result === 'SUCCESS' ? 'LOGIN' : 'LOGIN_FAILED';
  if (/\/logout(?:\/|$)/.test(lowerPath)) return 'LOGOUT';
  if (/\/register(?:\/|$)/.test(lowerPath)) return 'REGISTER';
  if (/\/export|\/report(?:s)?(?:\/|$)/.test(lowerPath)) return 'EXPORT';
  if (/\/approve(?:d)?(?:-forwarded)?(?:\/|$)/.test(lowerPath)) return 'APPROVE';
  if (/\/reject(?:ed)?(?:\/|$)/.test(lowerPath)) return 'REJECT';
  if (/\/review(?:\/|$)/.test(lowerPath)) return 'REVIEW';
  if (/\/forward(?:\/|$)/.test(lowerPath)) return 'FORWARD';
  if (/\/return(?:\/|$)/.test(lowerPath)) return 'RETURN';
  if (/\/borrow(?:\/|$)/.test(lowerPath)) return 'BORROW';
  if (/\/archive(?:\/|$)/.test(lowerPath)) return 'ARCHIVE';
  if (/\/restore(?:\/|$)/.test(lowerPath)) return 'RESTORE';
  if (/\/import(?:\/|$)/.test(lowerPath)) return 'IMPORT';
  if (/\/(?:submit|upload)(?:\/|$)/.test(lowerPath)) return 'UPLOAD';
  if (method === 'POST' && /\/student\/requirements(?:\/|$)/.test(lowerPath)) return 'UPLOAD';
  if (method === 'GET' || method === 'HEAD') return 'VIEW';
  if (method === 'DELETE') return 'DELETE';
  if (method === 'POST') return 'CREATE';
  if (method === 'PUT' || method === 'PATCH') return 'UPDATE';
  return method.slice(0, 20) || 'ACTIVITY';
};

const isLoginPath = (path) => /\/login(?:\/verify)?(?:\/|$)/i.test(path);
const isRegistrationPath = (path) => /\/register(?:\/|$)/i.test(path);
const isLogoutPath = (path) => /\/logout(?:\/|$)/i.test(path);
const isAuditPath = (path) => /\/admin\/audit-logs(?:\/|$)/i.test(path);

const getRefreshTokenFromRequest = (req) => {
  const cookieName = getRoleCookieName(REFRESH_COOKIE_NAME, getPortalRole(req));
  const roleCookieNames = ['admin', 'student', 'coach', 'screener', 'calendar']
    .map((role) => getRoleCookieName(REFRESH_COOKIE_NAME, role));
  const parsedToken = req.cookies?.[cookieName]
    || req.cookies?.[REFRESH_COOKIE_NAME]
    || roleCookieNames.map((name) => req.cookies?.[name]).find(Boolean);
  if (parsedToken) return parsedToken;

  const header = String(req.headers?.cookie || '');
  const headerCookies = {};
  const acceptedNames = new Set([cookieName, REFRESH_COOKIE_NAME, ...roleCookieNames]);
  for (const item of header.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0) continue;
    const name = item.slice(0, separator).trim();
    if (!acceptedNames.has(name)) continue;
    const value = item.slice(separator + 1).trim();
    try {
      headerCookies[name] = decodeURIComponent(value);
    } catch {
      headerCookies[name] = '';
    }
  }
  return headerCookies[cookieName]
    || headerCookies[REFRESH_COOKIE_NAME]
    || roleCookieNames.map((name) => headerCookies[name]).find(Boolean)
    || '';
};

const getActor = (req) => {
  const actor = req.user || req.auditActor;
  if (!actor) return null;
  return {
    userId: actor._id || actor.userId || '',
    actorName: actor.fullname || actor.name || actor.id || '',
    role: String(actor.role || '').trim().toLowerCase()
  };
};

const getResponseActor = (body) => {
  const actor = body?.user || body?.data?.user;
  if (!actor || typeof actor !== 'object') return null;
  return {
    userId: actor._id || actor.id || '',
    actorName: actor.fullname || actor.name || actor.id || '',
    role: String(actor.role || '').trim().toLowerCase()
  };
};

const getChangedFields = (value, prefix = '', depth = 0, fields = []) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 3) return fields;
  for (const [key, nestedValue] of Object.entries(value)) {
    if (SENSITIVE_FIELD.test(key)) continue;
    const field = prefix ? `${prefix}.${key}` : key;
    if (nestedValue && typeof nestedValue === 'object' && !Array.isArray(nestedValue)) {
      getChangedFields(nestedValue, field, depth + 1, fields);
    } else {
      fields.push(field.slice(0, 60));
    }
    if (fields.length >= 20) break;
  }
  return fields;
};

const getAffectedRecord = (req) => {
  const routeId = req.params && (
    req.params.id
    || req.params.studentId
    || req.params.requirementId
    || req.params.scheduleId
    || req.params.equipmentId
    || req.params.facultyId
  );
  const bodyId = req.body && (
    req.body.userId
    || req.body.studentId
    || req.body.requirementId
    || req.body.scheduleId
    || req.body.equipmentId
    || req.body.borrowingId
    || req.body.requestId
    || req.body.submissionId
    || req.body.id
    || req.body._id
  );
  const value = routeId || bodyId;
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const normalized = String(value).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return normalized && !normalized.includes('@') ? normalized.slice(0, 160) : '';
};

const isImportantView = (path) => IMPORTANT_VIEW_PATHS.some((pattern) => pattern.test(path));

const resolveLogoutActor = async (req) => {
  const rawToken = getRefreshTokenFromRequest(req);
  if (!rawToken) return null;
  try {
    const sessionQuery = RefreshSession.findOne({ tokenHash: hashRefreshToken(rawToken) });
    const session = await (sessionQuery && typeof sessionQuery.select === 'function'
      ? sessionQuery.select('userId')
      : sessionQuery);
    if (!session?.userId) return null;
    const userQuery = User.findById(session.userId);
    const user = await (userQuery && typeof userQuery.select === 'function'
      ? userQuery.select('_id id fullname role')
      : userQuery);
    return user ? {
      _id: user._id,
      id: user.id,
      fullname: user.fullname,
      role: user.role
    } : null;
  } catch {
    console.error('Audit logout actor lookup failed');
    return null;
  }
};

const recordSecurityEvent = (event) => {
  const safeEvent = {
    timestamp: new Date(),
    level: event.level,
    action: String(event.action || '').slice(0, 80),
    userId: String(event.userId || '').slice(0, 120),
    actorName: String(event.actorName || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120),
    role: String(event.role || '').slice(0, 40),
    module: String(event.module || '').slice(0, 80),
    description: String(event.description || '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 240),
    affectedRecord: String(event.affectedRecord || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 160),
    changedFields: Array.isArray(event.changedFields)
      ? event.changedFields.filter((field) => typeof field === 'string' && !SENSITIVE_FIELD.test(field)).slice(0, 20)
      : [],
    httpStatus: Number.isInteger(event.httpStatus) ? event.httpStatus : null,
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
  if (req[AUDIT_ATTACHED]) return next();
  req[AUDIT_ATTACHED] = true;
  let responseActor = null;
  let responseSucceeded;
  let responseRequiresLoginVerification = false;
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    responseActor = getResponseActor(body) || responseActor;
    if (typeof body?.success === 'boolean') responseSucceeded = body.success;
    responseRequiresLoginVerification = body?.verificationRequired === true;
    return originalJson(body);
  };

  res.on('finish', () => {
    if (res.locals?.auditLogRecorded) return;
    res.locals = res.locals || {};
    res.locals.auditLogRecorded = true;

    const method = String(req.method || 'GET').toUpperCase();
    const path = getRequestPath(req);
    if (isAuditPath(path)) return;

    const statusCode = res.statusCode;
    const result = statusCode >= 200 && statusCode < 400 && responseSucceeded !== false
      ? 'SUCCESS'
      : 'FAILURE';
    const login = isLoginPath(path);
    const registration = isRegistrationPath(path);
    const logout = isLogoutPath(path);
    const isMutation = MUTATING_METHODS.has(method);
    const importantView = (method === 'GET' || method === 'HEAD') && isImportantView(path);

    if (!isMutation && !importantView) return;
    if (login && responseRequiresLoginVerification && result === 'SUCCESS') return;
    if (registration && result === 'FAILURE') return;
    if (!login && !registration && !logout && !req.user && !req.auditActor) return;

    const actor = getActor(req) || responseActor;
    const record = async () => {
      const resolvedActor = actor || (logout ? await resolveLogoutActor(req) : null);
      if (!resolvedActor && !(registration && result === 'SUCCESS') && !(login && result === 'FAILURE')) return;

      const module = getModule(path);
      const action = getAction(method, path, result);
      const changedFields = isMutation ? getChangedFields(req.body) : [];
      const affectedRecord = getAffectedRecord(req);
      const role = resolvedActor?.role || (registration && result === 'SUCCESS' ? 'pending' : '');
      const actorName = resolvedActor?.actorName || (registration && result === 'SUCCESS' ? 'Pending account' : '');
      const changesSummary = changedFields.length ? ` Fields: ${changedFields.join(', ')}.` : '';
      const recordSummary = affectedRecord ? ` Record: ${affectedRecord}.` : '';
      const description = `${actorName || role || 'User'} ${action.toLowerCase().replace(/_/g, ' ')} in ${module}.${recordSummary}${changesSummary}`;

      void recordSecurityEvent({
        level: result === 'SUCCESS' ? 'INFO' : 'SECURITY',
        action,
        userId: resolvedActor?.userId || resolvedActor?._id || '',
        actorName,
        role,
        module,
        description,
        affectedRecord,
        changedFields,
        httpStatus: statusCode,
        identifier: login && result === 'FAILURE' && typeof req.body?.id === 'string' && !req.body.id.includes('@')
          ? req.body.id.slice(0, 120)
          : '',
        resource: path,
        ipAddress: getClientIp(req),
        result,
        reason: result === 'FAILURE' ? `http_${statusCode}` : ''
      });
    };

    void record().catch(() => {
      console.error('Security audit event processing failed');
    });
  });

  if (isLogoutPath(getRequestPath(req))) {
    resolveLogoutActor(req).then((actor) => {
      if (actor) req.auditActor = actor;
      next();
    });
    return;
  }
  next();
};

module.exports = { auditSecurityEvents, recordSecurityEvent };
