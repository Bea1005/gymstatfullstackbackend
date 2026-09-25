const { protect, authorize } = require('../../src/middleware/auth');
const jwt = require('jsonwebtoken');
const httpMocks = require('node-mocks-http');
const User = require('../../src/models/User');

jest.mock('jsonwebtoken');
jest.mock('../../src/models/User', () => ({
  findById: jest.fn(),
  findOne: jest.fn()
}));

describe('Auth Middleware Tests', () => {
  let req, res, next;

  // ✅ Suppress console.error for expected errors
  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterAll(() => {
    console.error.mockRestore();
  });

  beforeEach(() => {
    req = httpMocks.createRequest();
    res = httpMocks.createResponse();
    next = jest.fn();
    jest.clearAllMocks();
  });

  describe('protect middleware', () => {
    it('should call next() if valid token is provided', async () => {
      req.headers = { authorization: 'Bearer valid_token' };
      const decodedUser = { id: 'user123', role: 'admin' };
      const databaseUser = { _id: 'user123', id: 'user123', role: 'student' };
      jwt.verify.mockReturnValue(decodedUser);
      User.findById.mockReturnValue({
        select: jest.fn().mockResolvedValue(databaseUser)
      });

      await protect(req, res, next);

      expect(jwt.verify).toHaveBeenCalled();
      expect(req.user.role).toBe(databaseUser.role);
      expect(req.user.id).toBe(databaseUser.id);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('should reject a valid JWT if its user no longer exists in the database', async () => {
      req.headers = { authorization: 'Bearer valid_token' };
      jwt.verify.mockReturnValue({ id: 'deleted-user', role: 'admin' });
      User.findById.mockReturnValue({
        select: jest.fn().mockResolvedValue(null)
      });

      await protect(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject a database user without a stored role', async () => {
      req.headers = { authorization: 'Bearer valid_token' };
      jwt.verify.mockReturnValue({ id: 'user-without-role', role: 'admin' });
      User.findById.mockReturnValue({
        select: jest.fn().mockResolvedValue({ _id: 'user-without-role', id: 'user-without-role' })
      });

      await protect(req, res, next);

      expect(res.statusCode).toBe(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('should resolve a legacy string login id from the user record', async () => {
      req.headers = { authorization: 'Bearer valid_token' };
      const decodedUser = { id: '24B1510', role: 'student' };
      jwt.verify.mockReturnValue(decodedUser);
      User.findById.mockRejectedValue(new Error('Cast to ObjectId failed'));
      User.findOne.mockResolvedValue({
        _id: '507f1f77bcf86cd799439011',
        id: '24B1510',
        role: 'student'
      });

      await protect(req, res, next);

      expect(User.findOne).toHaveBeenCalledWith({
        $or: [{ _id: '24B1510' }, { id: '24B1510' }]
      });
      expect(req.user._id).toBe('507f1f77bcf86cd799439011');
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('should return 401 if no token is provided', async () => {
      req.headers = {};

      await protect(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(res._getJSONData().message).toBe('Not authorized to access this route');
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 if token is invalid', async () => {
      req.headers = { authorization: 'Bearer invalid_token' };
      jwt.verify.mockImplementation(() => {
        throw new Error('Invalid token');
      });

      await protect(req, res, next);

      expect(res.statusCode).toBe(401);
      expect(res._getJSONData().message).toBe('Not authorized to access this route');
    });
  });

  describe('authorize middleware', () => {
    it('should call next() if user role is authorized', () => {
      req.user = { role: 'admin' };
      const middleware = authorize('admin', 'coach');

      middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('should return 403 if user role is not authorized', () => {
      req.user = { role: 'student' };
      const middleware = authorize('admin', 'coach');

      middleware(req, res, next);

      expect(res.statusCode).toBe(403);
      expect(res._getJSONData().message).toContain('not authorized');
      expect(next).not.toHaveBeenCalled();
    });
  });
});