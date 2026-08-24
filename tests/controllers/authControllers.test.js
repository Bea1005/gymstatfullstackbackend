const httpMocks = require('node-mocks-http');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../../src/models/User');
const { register, login, forgotPassword } = require('../../src/controllers/authControllers');

jest.mock('../../src/models/User');
jest.mock('bcryptjs');
jest.mock('jsonwebtoken');

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
        id: 'ABC123'
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

  it('infers a coach role from a longer ID during registration', async () => {
    const req = httpMocks.createRequest({
      body: {
        fullname: 'Coach User',
        username: 'coachuser',
        email: 'coach@example.com',
        password: 'Password1!',
        role: 'student',
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
      role: 'coach',
      department: '',
      sport: '',
      id: 'A123456'
    });

    await register(req, res);

    expect(User.create).toHaveBeenCalledWith(expect.objectContaining({ role: 'coach' }));
    expect(res._getJSONData().user.role).toBe('coach');
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

  it('corrects a mismatched stored role using the ID format during login', async () => {
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
    expect(user.role).toBe('coach');
    expect(res._getJSONData().user.role).toBe('coach');
  });

  it('resets a password when the ID and email belong to the same account', async () => {
    const req = httpMocks.createRequest({
      body: {
        id: 'Coach1234',
        email: 'coach@example.com',
        newPassword: 'NewPassword1!'
      }
    });
    const res = httpMocks.createResponse();

    const user = {
      _id: 'user123',
      id: 'Coach1234',
      email: 'coach@example.com',
      password: 'old-hash',
      save: jest.fn().mockResolvedValue(true)
    };

    User.findOne.mockResolvedValue(user);
    bcrypt.hash.mockResolvedValue('new-hash');

    await forgotPassword(req, res);

    expect(user.save).toHaveBeenCalled();
    expect(user.password).toBe('new-hash');
    expect(res.statusCode).toBe(200);
    expect(res._getJSONData().success).toBe(true);
  });
});
