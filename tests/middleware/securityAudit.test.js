const httpMocks = require('node-mocks-http');
const EventEmitter = require('events');

jest.mock('../../src/models/SecurityLog', () => ({
  create: jest.fn().mockResolvedValue({})
}));
jest.mock('../../src/models/RefreshSession', () => ({
  findOne: jest.fn()
}));
jest.mock('../../src/models/User', () => ({
  findById: jest.fn()
}));

const SecurityLog = require('../../src/models/SecurityLog');
const RefreshSession = require('../../src/models/RefreshSession');
const User = require('../../src/models/User');
const { auditSecurityEvents } = require('../../src/middleware/securityAudit');

const runAudit = ({ method, url, user, body, params = {}, statusCode = 200, responseBody } = {}) => {
  const req = httpMocks.createRequest({
    method: method || 'POST',
    url: url || '/api/v1/admin/users/user-123',
    body: body || {},
    user,
    params,
    ip: '127.0.0.1'
  });
  const res = Object.assign(new EventEmitter(), {
    statusCode: 200,
    locals: {},
    json: jest.fn(function returnResponse() { return this; })
  });
  const next = jest.fn();

  auditSecurityEvents(req, res, next);
  if (responseBody) res.json(responseBody);
  res.statusCode = statusCode;
  res.emit('finish');
  return { req, res, next };
};

describe('security audit middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('records authenticated mutations with safe changed-field names', () => {
    const user = {
      _id: 'admin-db-id',
      id: 'admin-1',
      fullname: 'Admin User',
      role: 'admin',
      email: 'admin@example.com',
      password: 'never-log-this'
    };

    runAudit({
      method: 'PATCH',
      url: '/api/v1/users/user-123',
      user,
      params: { id: 'user-123' },
      body: { role: 'coach', department: 'CICS', password: 'not-safe', contactNumber: 'not-safe' }
    });

    expect(SecurityLog.create).toHaveBeenCalledTimes(1);
    expect(SecurityLog.create).toHaveBeenCalledWith(expect.objectContaining({
      action: 'UPDATE',
      module: 'User Management',
      userId: 'admin-db-id',
      actorName: 'Admin User',
      role: 'admin',
      affectedRecord: 'user-123',
      changedFields: ['role', 'department'],
      result: 'SUCCESS',
      httpStatus: 200
    }));
    expect(JSON.stringify(SecurityLog.create.mock.calls[0][0])).not.toMatch(/never-log-this|not-safe|admin@example\.com/);
  });

  it('records failed authenticated mutations as failures', () => {
    runAudit({
      method: 'DELETE',
      url: '/api/v1/admin/equipment/item-1',
      user: { _id: 'admin-db-id', fullname: 'Admin User', role: 'admin' },
      statusCode: 409
    });

    expect(SecurityLog.create).toHaveBeenCalledWith(expect.objectContaining({
      action: 'DELETE',
      module: 'Equipment',
      result: 'FAILURE',
      reason: 'http_409',
      httpStatus: 409
    }));
  });

  it('records successful login actors from the server response, without token fields', () => {
    runAudit({
      method: 'POST',
      url: '/api/v1/login',
      responseBody: {
        success: true,
        accessToken: 'do-not-log',
        user: { _id: 'user-db-id', fullname: 'Student User', role: 'student', password: 'do-not-log' }
      }
    });

    expect(SecurityLog.create).toHaveBeenCalledWith(expect.objectContaining({
      action: 'LOGIN',
      module: 'Authentication',
      userId: 'user-db-id',
      actorName: 'Student User',
      role: 'student',
      result: 'SUCCESS'
    }));
    expect(JSON.stringify(SecurityLog.create.mock.calls[0][0])).not.toContain('do-not-log');
  });

  it('records curated authenticated views and skips Audit Log requests', () => {
    const user = { _id: 'coach-db-id', fullname: 'Coach User', role: 'coach' };
    runAudit({
      method: 'GET',
      url: '/api/v1/coach/athletes/student-1/requirements',
      user,
      params: { studentId: 'student-1' }
    });
    runAudit({ method: 'GET', url: '/api/v1/admin/audit-logs', user: { ...user, role: 'admin' } });

    expect(SecurityLog.create).toHaveBeenCalledTimes(1);
    expect(SecurityLog.create).toHaveBeenCalledWith(expect.objectContaining({
      action: 'VIEW',
      module: 'Coach Requirements',
      affectedRecord: 'student-1'
    }));
  });

  it('classifies forwarded approval and requirement submission as audit actions', () => {
    runAudit({
      method: 'PUT',
      url: '/api/v1/screener/requirements/approve-forwarded',
      user: { _id: 'screener-id', fullname: 'Screener User', role: 'screener' }
    });
    runAudit({
      method: 'POST',
      url: '/api/v1/student/requirements',
      user: { _id: 'student-id', fullname: 'Student User', role: 'student' }
    });

    expect(SecurityLog.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ action: 'APPROVE' }));
    expect(SecurityLog.create).toHaveBeenNthCalledWith(2, expect.objectContaining({ action: 'UPLOAD' }));
  });

  it('resolves logout identity from the refresh session before the route removes it', async () => {
    RefreshSession.findOne.mockResolvedValue({ userId: 'student-db-id' });
    User.findById.mockResolvedValue({
      _id: 'student-db-id',
      id: 'student-1',
      fullname: 'Student User',
      role: 'student'
    });
    const req = httpMocks.createRequest({
      method: 'POST',
      url: '/api/v1/logout',
      headers: { cookie: 'refreshToken=opaque-refresh-token' }
    });
    const res = Object.assign(new EventEmitter(), {
      statusCode: 200,
      locals: {},
      json: jest.fn(function returnResponse() { return this; })
    });
    const next = jest.fn();

    auditSecurityEvents(req, res, next);
    await new Promise((resolve) => setImmediate(resolve));
    res.emit('finish');

    expect(next).toHaveBeenCalledTimes(1);
    expect(SecurityLog.create).toHaveBeenCalledWith(expect.objectContaining({
      action: 'LOGOUT',
      userId: 'student-db-id',
      actorName: 'Student User',
      role: 'student',
      result: 'SUCCESS'
    }));
    expect(JSON.stringify(RefreshSession.findOne.mock.calls[0][0])).not.toContain('opaque-refresh-token');
  });
});
