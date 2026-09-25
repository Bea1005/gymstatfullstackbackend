const httpMocks = require('node-mocks-http');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../../src/models/User');
const { register, login, requestPasswordReset, resetPassword } = require('../../src/controllers/authControllers');

jest.mock('../../src/models/User');
jest.mock('../../src/models/RefreshSession', () => ({
  create: jest.fn().mockResolvedValue({}),
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn(),
  updateMany: jest.fn(),
}));
jest.mock('bcryptjs');
jest.mock('jsonwebtoken');
jest.mock('../../src/config/email', () => ({
  sendPasswordResetOtp: jest.fn().mockResolvedValue(true)
}));

describe('Auth Controllers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.log.mockRestore();
    console.error.mockRestore();
  });

  it('assigns a student role when the ID is exactly 7 alphanumeric characters', async () => {
    const req = httpMocks.createRequest({
      body: {
        fullname: 'Jane Doe',
        username: 'janedoe',
        email: 'jane@example.com',
        password: 'Password1!',
        role: 'coach',
        department: 'CICS',
        id: '23B1509'
      }
    });
    const res = httpMocks.createResponse();

    User.findOne.mockResolvedValue(null);
    bcrypt.genSalt.mockResolvedValue('salt');
    bcrypt.hash.mockResolvedValue('hashed-password');
    User.create.mockResolvedValue({
      _id: 'user123',
      fullname: 'Jane Doe',
      username: 'janedoe',
      email: 'jane@example.com',
      role: 'student',
      department: 'CICS',
      sport: '',
      id: '23B1509'
    });

    await register(req, res);

    expect(res.statusCode).toBe(201);
    expect(User.create).toHaveBeenCalledWith(expect.objectContaining({ role: 'student' }));
    expect(res._getJSONData().user.role).toBe('student');
  });

  it('rejects IDs that are shorter than 7 characters during registration', async () => {
    const req = httpMocks.createRequest({
      body: {
        fullname: 'Jane Doe',
        username: 'janedoe',
        email: 'jane@example.com',
        password: 'Password1!',
        role: 'student',
        id: 'ABC12'
      }
    });
    const res = httpMocks.createResponse();

    await register(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._getJSONData().message).toContain('7');
  });

  it('rejects duplicate IDs during registration', async () => {
    const req = httpMocks.createRequest({
      body: {
        fullname: 'Jane Doe',
        username: 'janedoe',
        email: 'jane@example.com',
        password: 'Password1!',
        role: 'student',
        id: '23B1509'
      }
    });
    const res = httpMocks.createResponse();

    User.findOne.mockResolvedValue({ id: '23B1509' });

    await register(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._getJSONData().message).toContain('already exists');
  });

  it('keeps the default student role for a valid long ID during registration', async () => {
    const req = httpMocks.createRequest({
      body: {
        fullname: 'Coach User',
        username: 'coachuser',
        email: 'coach@example.com',
        password: 'Password1!',
        role: 'coach',
        id: 'A1234567'
      }
    });
    const res = httpMocks.createResponse();

    User.findOne.mockResolvedValue(null);
    bcrypt.genSalt.mockResolvedValue('salt');
    bcrypt.hash.mockResolvedValue('hashed-password');
    User.create.mockResolvedValue({
      _id: 'user123',
      fullname: 'Coach User',
      username: 'coachuser',
      email: 'coach@example.com',
      role: 'student',
      department: '',
      sport: '',
      id: 'A1234567'
    });

    await register(req, res);

    expect(User.create).toHaveBeenCalledWith(expect.objectContaining({ role: 'student' }));
    expect(res._getJSONData().user.role).toBe('student');
  });

  it('returns the saved role from the database during login', async () => {
    const req = httpMocks.createRequest({
      body: {
        id: 'Coach123',
        password: 'Password1!'
      }
    });
    const res = httpMocks.createResponse();

    User.findOne.mockResolvedValue({
      _id: 'user123',
      id: 'Coach123',
      fullname: 'Coach User',
      username: 'coachuser',
      email: 'coach@example.com',
      password: 'hashed-password',
      role: 'coach',
      department: '',
      sport: ''
    });
    bcrypt.compare.mockResolvedValue(true);
    jwt.sign.mockReturnValue('jwt-token');

    await login(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._getJSONData().user.role).toBe('coach');
    expect(jwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'coach' }),
      expect.any(String),
      expect.any(Object)
    );
  });

  it('uses the persisted user role during login without re-inferring from the ID format', async () => {
    const req = httpMocks.createRequest({
      body: {
        id: 'Coach1234',
        password: 'Password1!'
      }
    });
    const res = httpMocks.createResponse();

    const user = {
      _id: 'user123',
      id: 'Coach1234',
      fullname: 'Coach User',
      username: 'coachuser',
      email: 'coach@example.com',
      password: 'hashed-password',
      role: 'student',
      department: '',
      sport: '',
      save: jest.fn().mockResolvedValue(true)
    };

    User.findOne.mockResolvedValue(user);
    bcrypt.compare.mockResolvedValue(true);
    jwt.sign.mockReturnValue('jwt-token');

    await login(req, res);

    expect(user.save).toHaveBeenCalled();
    expect(user.role).toBe('student');
    expect(res._getJSONData().user.role).toBe('student');
  });

  it('creates a reset challenge without exposing whether an email exists', async () => {
    const req = httpMocks.createRequest({
      body: {
        email: 'coach@example.com',
      }
    });
    const res = httpMocks.createResponse();

    const user = {
      _id: 'user123',
      email: 'coach@example.com',
      passwordResetLastSentAt: null,
      save: jest.fn().mockResolvedValue(true)
    };

    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });

    await requestPasswordReset(req, res);

    expect(user.save).toHaveBeenCalled();
    expect(user.passwordResetOtpHash).toMatch(/^[a-f0-9]{64}$/);
    expect(res.statusCode).toBe(202);
    expect(res._getJSONData().success).toBe(true);
    expect(res._getJSONData().message).toContain('If an account is associated');
  });

  it('requires a verified reset challenge before changing a password', async () => {
    const req = httpMocks.createRequest({
      body: {
        email: 'coach@example.com',
        newPassword: 'NewPassword1!'
      }
    });
    const res = httpMocks.createResponse();

    User.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        email: 'coach@example.com',
        passwordResetVerifiedAt: null,
        save: jest.fn()
      })
    });

    await resetPassword(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._getJSONData().success).toBe(false);
  });
});
