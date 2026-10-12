const express = require('express');
const request = require('supertest');
const User = require('../../src/models/User');
const userRoutes = require('../../src/routes/userRoutes');

jest.mock('../../src/models/User', () => ({
  hasRegisteredId: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn()
}));
jest.mock('../../src/middleware/auth', () => ({
  protect: (req, res, next) => next(),
  authorize: () => (req, res, next) => next()
}));
jest.mock('../../src/config/passwords', () => ({
  hashPassword: jest.fn().mockResolvedValue('hashed-password')
}));

describe('User registration route', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    User.hasRegisteredId.mockResolvedValue(false);
    app = express();
    app.use(express.json());
    app.use('/api/v1/users', userRoutes);
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  it.each(['student', 'coach', 'screener', 'admin'])(
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
    User.findOne.mockResolvedValue(null);
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
});
