const express = require('express');
const request = require('supertest');
const User = require('../../src/models/User');
const ScreenerIdSequence = require('../../src/models/ScreenerIdSequence');
const userRoutes = require('../../src/routes/userRoutes');

jest.mock('../../src/models/User', () => ({
  hasRegisteredId: jest.fn(),
  hasRegisteredEmail: jest.fn(),
  ensureEmailIndex: jest.fn(),
  find: jest.fn(),
  deleteOne: jest.fn(),
  getRoleModel: jest.fn(),
  updateOne: jest.fn(),
  create: jest.fn()
}));
jest.mock('../../src/models/ScreenerIdSequence', () => ({
  findById: jest.fn(),
  updateOne: jest.fn(),
  findOneAndUpdate: jest.fn()
}));
jest.mock('../../src/middleware/auth', () => ({
  protect: (req, res, next) => next(),
  authorize: () => (req, res, next) => next()
}));
jest.mock('../../src/config/passwords', () => ({
  hashPassword: jest.fn().mockResolvedValue('hashed-password'),
  isPasswordValid: jest.fn().mockReturnValue(true),
  PASSWORD_POLICY_MESSAGE: 'Invalid password.'
}));
jest.mock('../../src/config/security', () => ({
  getJWTSecret: jest.fn().mockReturnValue('test-jwt-secret')
}));
jest.mock('../../src/config/email', () => ({
  sendRegistrationVerificationOtp: jest.fn().mockResolvedValue(true),
  sendScreenerAccountCreatedEmail: jest.fn().mockResolvedValue(true),
  sendScreenerAuthorizationEmail: jest.fn().mockResolvedValue(true)
}));
const { sendRegistrationVerificationOtp, sendScreenerAccountCreatedEmail } = require('../../src/config/email');

describe('User registration route', () => {
  let app;
  const year = String(new Date().getFullYear());

  beforeEach(() => {
    jest.clearAllMocks();
    User.hasRegisteredId.mockResolvedValue(false);
    User.hasRegisteredEmail.mockResolvedValue(false);
    User.ensureEmailIndex.mockResolvedValue('emailNormalized_1');
    User.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([])
    });
    User.deleteOne.mockResolvedValue({ deletedCount: 1 });
    User.getRoleModel.mockReturnValue({ deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }) });
    ScreenerIdSequence.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null)
    });
    ScreenerIdSequence.updateOne.mockResolvedValue({});
    ScreenerIdSequence.findOneAndUpdate.mockResolvedValue({ value: 1 });
    sendRegistrationVerificationOtp.mockResolvedValue(true);
    app = express();
    app.use(express.json());
    app.use('/api/v1/users', userRoutes);
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  it('returns the next Screener ID for the Admin registration form', async () => {
    ScreenerIdSequence.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ value: 2 })
    });
    User.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{ id: `S${year}-0002` }, { id: `S${year}-0001` }])
    });

    const response = await request(app).get('/api/v1/users/screeners/next-id');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, id: `S${year}-0003` });
    expect(User.find).toHaveBeenCalledWith({
      role: 'screener',
      id: { $regex: new RegExp(`^S${year}-[0-9A-F]{4}$`, 'i') }
    });
  });

  it.each(['student', 'coach', 'admin'])(
    'rejects a duplicate ID for a %s account',
    async (role) => {
      User.hasRegisteredId.mockResolvedValue(true);

      const response = await request(app)
        .post('/api/v1/users')
        .send({
          id: 'ID-123456',
          fullname: 'New Account',
          email: `${role}@example.com`,
          password: 'Password1!',
          role
        });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        success: false,
        message: 'This ID is already registered. Please use a different ID.'
      });
      expect(User.create).not.toHaveBeenCalled();
    }
  );

  it('returns the same duplicate ID message when MongoDB rejects a concurrent account creation', async () => {
    User.create.mockRejectedValue({
      code: 11000,
      keyPattern: { id: 1 },
      keyValue: { id: 'ID-123456' }
    });

    const response = await request(app)
      .post('/api/v1/users')
      .send({
        id: 'ID-123456',
        fullname: 'New Admin',
        email: 'admin@example.com',
        password: 'Password1!',
        role: 'admin'
      });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      success: false,
      message: 'This ID is already registered. Please use a different ID.'
    });
  });

  it.each(['student', 'coach', 'admin'])(
    'creates a pending %s account and sends a registration code without exposing verification data',
    async (role) => {
      const createdUser = {
        _id: 'user-123',
        id: 'ID-123456',
        fullname: 'New Account',
        email: 'new@example.com',
        emailNormalized: 'new@example.com',
        emailVerified: false,
        registrationOtpHash: 'private-hash',
        registrationOtpExpiresAt: new Date(),
        registrationOtpAttempts: 0,
        registrationOtpLastSentAt: new Date(),
        registrationOtpResendCount: 0,
        password: 'hashed-password',
        role,
        toObject() {
          return { ...this };
        }
      };
      User.create.mockResolvedValue(createdUser);

      const response = await request(app)
        .post('/api/v1/users')
        .send({
          id: 'ID-123456',
          fullname: 'New Account',
          email: 'New@Example.com',
          password: 'Password1!',
          role
        });

      expect(response.status).toBe(201);
      expect(response.body).toEqual(expect.objectContaining({
        success: true,
        verificationRequired: true
      }));
      expect(User.create).toHaveBeenCalledWith(expect.objectContaining({
        id: 'ID-123456',
        email: 'new@example.com',
        emailNormalized: 'new@example.com',
        emailVerified: false,
        registrationOtpHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        registrationOtpExpiresAt: expect.any(Date),
        role
      }));
      expect(sendRegistrationVerificationOtp).toHaveBeenCalledWith(
        'new@example.com',
        expect.stringMatching(/^\d{6}$/),
        10
      );
      expect(response.body).not.toHaveProperty('otp');
      expect(response.body.user).not.toHaveProperty('emailNormalized');
      expect(response.body.user).not.toHaveProperty('registrationOtpHash');
      expect(response.body.user).not.toHaveProperty('registrationOtpExpiresAt');
      expect(response.body.user).not.toHaveProperty('password');
    }
  );

  it.each([undefined, 'Not a valid college'])(
    'rejects a Screener account with an empty or invalid college (%s)',
    async (college) => {
      const requestBody = {
        email: 'screener@example.com',
        password: 'Password1!',
        role: 'screener'
      };
      if (college !== undefined) requestBody.college = college;

      const response = await request(app)
        .post('/api/v1/users')
        .send(requestBody);

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Please select a valid college.');
      expect(User.create).not.toHaveBeenCalled();
      expect(ScreenerIdSequence.findOneAndUpdate).not.toHaveBeenCalled();
    }
  );

  it('creates a Screener account as login-ready without sending an email', async () => {
    const createdUser = {
      _id: 'user-123',
      id: `S${year}-0001`,
      fullname: `S${year}-0001`,
      email: 'screener@example.com',
      emailNormalized: 'screener@example.com',
      emailVerified: true,
      password: 'hashed-password',
      role: 'screener',
      college: 'College of Engineering',
      toObject() {
        return { ...this };
      }
    };
    User.create.mockResolvedValue(createdUser);

    const response = await request(app)
      .post('/api/v1/users')
      .send({
        email: 'screener@example.com',
        password: 'Password1!',
        department: 'Engineering',
        college: 'College of Engineering',
        role: 'screener'
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(expect.objectContaining({
      success: true,
      verificationRequired: false
    }));
    expect(response.body.user.id).toBe(`S${year}-0001`);
    expect(User.create).toHaveBeenCalledWith(expect.objectContaining({
      email: 'screener@example.com',
      emailVerified: true,
      department: 'Engineering',
      college: 'College of Engineering',
      role: 'screener',
      id: `S${year}-0001`,
      password: 'hashed-password'
    }));
    expect(User.create.mock.calls[0][0]).not.toHaveProperty('registrationOtpHash');
    expect(response.body.user.college).toBe('College of Engineering');
    expect(sendRegistrationVerificationOtp).not.toHaveBeenCalled();
    expect(sendScreenerAccountCreatedEmail).not.toHaveBeenCalled();
  });

  it('does not block a Screener account when email delivery is unavailable', async () => {
    User.create.mockResolvedValue({ _id: 'user-123', id: `S${year}-0001` });
    sendScreenerAccountCreatedEmail.mockRejectedValueOnce(new Error('Brevo unavailable'));

    const response = await request(app)
      .post('/api/v1/users')
      .send({
        fullname: 'New Screener',
        email: 'screener@example.com',
        password: 'Password1!',
        college: 'College of Engineering',
        role: 'screener'
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(expect.objectContaining({
      success: true,
      verificationRequired: false
    }));
    expect(User.deleteOne).not.toHaveBeenCalled();
    expect(User.getRoleModel).not.toHaveBeenCalled();
    expect(sendScreenerAccountCreatedEmail).not.toHaveBeenCalled();
  });

  it('generates the next sequential Screener ID and ignores any client-supplied ID', async () => {
    ScreenerIdSequence.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ value: 8 })
    });
    ScreenerIdSequence.findOneAndUpdate.mockResolvedValue({ value: 9 });
    User.create.mockResolvedValue({
      _id: 'user-123',
      id: `S${year}-0009`,
      fullname: `S${year}-0009`,
      email: 'screener@example.com',
      role: 'screener',
      toObject() {
        return { ...this };
      }
    });

    const response = await request(app)
      .post('/api/v1/users')
      .send({
        id: 'client-controlled-id',
        email: 'screener@example.com',
        password: 'Password1!',
        department: 'Engineering',
        college: 'College of Engineering',
        role: 'screener'
      });

    expect(response.status).toBe(201);
    expect(User.create).toHaveBeenCalledWith(expect.objectContaining({
      id: `S${year}-0009`,
      fullname: `S${year}-0009`,
      role: 'screener',
      department: 'Engineering',
      college: 'College of Engineering'
    }));
    expect(response.body.user.id).toBe(`S${year}-0009`);
  });

  it('retries with a new sequential ID after a concurrent duplicate ID insert', async () => {
    ScreenerIdSequence.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ value: 0 })
    });
    ScreenerIdSequence.findOneAndUpdate
      .mockResolvedValueOnce({ value: 1 })
      .mockResolvedValueOnce({ value: 2 });
    User.create
      .mockRejectedValueOnce({
        code: 11000,
        keyPattern: { id: 1 },
        keyValue: { id: `S${year}-0001` }
      })
      .mockResolvedValueOnce({
        _id: 'user-123',
        id: `S${year}-0002`,
        fullname: `S${year}-0002`,
        email: 'screener@example.com',
        role: 'screener',
        toObject() {
          return { ...this };
        }
      });

    const response = await request(app)
      .post('/api/v1/users')
      .send({
        email: 'screener@example.com',
        password: 'Password1!',
        college: 'College of Engineering',
        role: 'screener'
      });

    expect(response.status).toBe(201);
    expect(User.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: `S${year}-0001` }));
    expect(User.create).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: `S${year}-0002` }));
    expect(response.body.user.id).toBe(`S${year}-0002`);
  });

  it('rejects an email already registered in any role collection', async () => {
    User.hasRegisteredEmail.mockResolvedValue(true);

    const response = await request(app)
      .post('/api/v1/users')
      .send({
        id: 'ID-123456',
        fullname: 'New Account',
        email: 'existing@example.com',
        password: 'Password1!',
        role: 'student'
      });

    expect(response.status).toBe(409);
    expect(User.create).not.toHaveBeenCalled();
    expect(sendRegistrationVerificationOtp).not.toHaveBeenCalled();
  });
});
