const httpMocks = require('node-mocks-http');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../../src/models/User');
const RefreshSession = require('../../src/models/RefreshSession');
const { getJWTSecret } = require('../../src/config/security');
const { hashRefreshToken } = require('../../src/config/authTokens');
const { register, login, requestPasswordReset, verifyPasswordResetOtp, resetPassword, refreshSession, logout } = require('../../src/controllers/authControllers');

jest.mock('../../src/models/User');
jest.mock('../../src/models/RefreshSession', () => ({
  create: jest.fn().mockResolvedValue({}),
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn(),
  updateMany: jest.fn(),
}));
jest.mock('bcryptjs');
jest.mock('jsonwebtoken');
jest.mock('../../src/config/email', () => ({
  sendPasswordResetOtp: jest.fn().mockResolvedValue(true)
}));

const hashResetValue = (value) => crypto
  .createHmac('sha256', getJWTSecret())
  .update(String(value))
  .digest('hex');

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

  it('saves and returns student year level and all registered sports', async () => {
    const req = httpMocks.createRequest({
      body: {
        fullname: 'Jane Doe',
        email: 'jane@example.com',
        password: 'Password1!',
        department: 'CICS',
        yearLevel: 'II',
        sport: 'Basketball Women',
        sports: ['Basketball Women', 'Softball Women'],
        id: '23B1509'
      }
    });
    const res = httpMocks.createResponse();

    User.findOne.mockResolvedValue(null);
    bcrypt.genSalt.mockResolvedValue('salt');
    bcrypt.hash.mockResolvedValue('hashed-password');
    User.create.mockImplementation(async (user) => ({ _id: 'user123', ...user }));

    await register(req, res);

    expect(res.statusCode).toBe(201);
    expect(User.create).toHaveBeenCalledWith(expect.objectContaining({
      role: 'student',
      yearLevel: 'II',
      sport: 'Basketball Women',
      sports: ['Basketball Women', 'Softball Women']
    }));
    expect(res._getJSONData().user).toEqual(expect.objectContaining({
      yearLevel: 'II',
      sport: 'Basketball Women',
      sports: ['Basketball Women', 'Softball Women']
    }));
  });

  it('rejects unsupported student year levels during registration', async () => {
    const req = httpMocks.createRequest({
      body: {
        fullname: 'Jane Doe',
        email: 'jane@example.com',
        password: 'Password1!',
        yearLevel: 'V',
        sport: 'Basketball Women',
        id: '23B1509'
      }
    });
    const res = httpMocks.createResponse();

    User.findOne.mockResolvedValue(null);
    bcrypt.genSalt.mockResolvedValue('salt');
    bcrypt.hash.mockResolvedValue('hashed-password');

    await register(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._getJSONData().message).toContain('year level');
    expect(User.create).not.toHaveBeenCalled();
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

  it.each(['2019-0219', '2024-1234', '1998-0001', '2026-9876'])(
    'assigns the coach role for Coach-format ID %s regardless of the submitted role',
    async (coachId) => {
    const req = httpMocks.createRequest({
      body: {
        fullname: 'Coach User',
        email: 'coach@example.com',
        password: 'Password1!',
        role: 'student',
        id: coachId
      }
    });
    const res = httpMocks.createResponse();

    User.findOne.mockResolvedValue(null);
    bcrypt.genSalt.mockResolvedValue('salt');
    bcrypt.hash.mockResolvedValue('hashed-password');
    User.create.mockResolvedValue({
      _id: 'user123',
      fullname: 'Coach User',
      email: 'coach@example.com',
      role: 'coach',
      department: '',
      sport: '',
      id: coachId
    });

    await register(req, res);

    expect(User.create).toHaveBeenCalledWith(expect.objectContaining({
      id: coachId,
      role: 'coach'
    }));
    expect(res.statusCode).toBe(201);
    expect(res._getJSONData().user.role).toBe('coach');
    }
  );

  it('returns the saved role from the database during login', async () => {
    const req = httpMocks.createRequest({
      body: {
        id: 'Coach123',
        password: 'Password1!'
      }
    });
    const res = httpMocks.createResponse();
    const setCookie = jest.spyOn(res, 'cookie');

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
    expect(setCookie.mock.calls.map(([name]) => name)).toEqual([
      'accessToken_coach', 'refreshToken_coach', 'csrfToken_coach',
    ]);
    expect(jwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'coach' }),
      expect.any(String),
      expect.any(Object)
    );
  });

  it('looks up a hyphenated Coach ID without changing its string value', async () => {
    const req = httpMocks.createRequest({
      body: {
        id: '2019-0219',
        password: 'Password1!'
      }
    });
    const res = httpMocks.createResponse();

    User.findOne.mockResolvedValue({
      _id: 'user123',
      id: '2019-0219',
      fullname: 'Coach User',
      password: 'hashed-password',
      role: 'coach',
      save: jest.fn().mockResolvedValue(true)
    });
    bcrypt.compare.mockResolvedValue(true);
    jwt.sign.mockReturnValue('jwt-token');

    await login(req, res);

    expect(User.findOne).toHaveBeenCalledWith({ id: '2019-0219' });
    expect(res.statusCode).toBe(200);
    expect(res._getJSONData().user.role).toBe('coach');
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
      passwordResetTokenHash: 'previous-token-hash',
      passwordResetTokenExpiresAt: new Date(Date.now() + 60_000),
      passwordResetTokenConsumedAt: null,
      save: jest.fn().mockResolvedValue(true)
    };

    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });

    await requestPasswordReset(req, res);

    expect(user.save).toHaveBeenCalled();
    expect(user.passwordResetOtpHash).toMatch(/^[a-f0-9]{64}$/);
    expect(user.passwordResetTokenHash).toBeNull();
    expect(user.passwordResetTokenExpiresAt).toBeNull();
    expect(user.passwordResetTokenConsumedAt).toBeNull();
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

  it('issues a random reset token after atomically consuming the valid OTP', async () => {
    const otp = '123456';
    const user = {
      _id: 'user123',
      email: 'coach@example.com',
      passwordResetOtpHash: hashResetValue(otp),
      passwordResetOtpExpiresAt: new Date(Date.now() + 60_000),
      passwordResetOtpAttempts: 0,
      save: jest.fn().mockResolvedValue(true)
    };
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });
    User.findOneAndUpdate.mockResolvedValue({ _id: 'user123' });

    const req = httpMocks.createRequest({ body: { email: user.email, otp } });
    const res = httpMocks.createResponse();

    await verifyPasswordResetOtp(req, res);

    const response = res._getJSONData();
    const [filter, update] = User.findOneAndUpdate.mock.calls[0];
    expect(res.statusCode).toBe(200);
    expect(response.resetToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(update.$set.passwordResetTokenHash).toBe(hashResetValue(response.resetToken));
    expect(update.$set.passwordResetTokenHash).not.toBe(response.resetToken);
    expect(update.$set.passwordResetTokenExpiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(filter).toEqual(expect.objectContaining({
      _id: user._id,
      passwordResetOtpHash: user.passwordResetOtpHash,
      passwordResetOtpAttempts: { $lt: 5 }
    }));
    expect(user.save).not.toHaveBeenCalled();
  });

  it('changes the password with the reset token and revokes every active refresh session', async () => {
    const resetToken = crypto.randomBytes(32).toString('base64url');
    bcrypt.hash.mockResolvedValue('new-secure-password-hash');
    User.findOneAndUpdate.mockResolvedValue({ _id: 'user123' });
    const req = httpMocks.createRequest({
      body: { email: 'coach@example.com', resetToken, newPassword: 'NewPassword1!' }
    });
    const res = httpMocks.createResponse();

    await resetPassword(req, res);

    const [filter, update, options] = User.findOneAndUpdate.mock.calls[0];
    expect(res.statusCode).toBe(200);
    expect(filter).toEqual(expect.objectContaining({
      email: { $regex: '^coach@example\\.com$', $options: 'i' },
      passwordResetTokenHash: hashResetValue(resetToken),
      passwordResetTokenExpiresAt: { $gt: expect.any(Date) },
      passwordResetTokenConsumedAt: null
    }));
    expect(update.$set.password).toBe('new-secure-password-hash');
    expect(update.$set.passwordChangedAt).toBeInstanceOf(Date);
    expect(update.$set.passwordResetTokenConsumedAt).toBeInstanceOf(Date);
    expect(options.runValidators).toBe(true);
    expect(RefreshSession.updateMany).toHaveBeenCalledWith(
      { userId: 'user123', revokedAt: null },
      { $set: { revokedAt: expect.any(Date) } }
    );
    expect(JSON.stringify(res._getJSONData())).not.toContain(resetToken);
  });

  it('rejects email and password without a reset token', async () => {
    const req = httpMocks.createRequest({
      body: { email: 'coach@example.com', newPassword: 'NewPassword1!' }
    });
    const res = httpMocks.createResponse();

    await resetPassword(req, res);

    expect(res.statusCode).toBe(400);
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
    expect(RefreshSession.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a token used with a different account email', async () => {
    const resetToken = crypto.randomBytes(32).toString('base64url');
    bcrypt.hash.mockResolvedValue('new-secure-password-hash');
    User.findOneAndUpdate.mockResolvedValue(null);
    const req = httpMocks.createRequest({
      body: { email: 'other@example.com', resetToken, newPassword: 'NewPassword1!' }
    });
    const res = httpMocks.createResponse();

    await resetPassword(req, res);

    expect(res.statusCode).toBe(400);
    expect(User.findOneAndUpdate.mock.calls[0][0].email).toEqual({
      $regex: '^other@example\\.com$',
      $options: 'i'
    });
    expect(RefreshSession.updateMany).not.toHaveBeenCalled();
  });

  it('rejects an expired reset token', async () => {
    const resetToken = crypto.randomBytes(32).toString('base64url');
    bcrypt.hash.mockResolvedValue('new-secure-password-hash');
    User.findOneAndUpdate.mockResolvedValue(null);
    const req = httpMocks.createRequest({
      body: { email: 'coach@example.com', resetToken, newPassword: 'NewPassword1!' }
    });
    const res = httpMocks.createResponse();

    await resetPassword(req, res);

    expect(res.statusCode).toBe(400);
    expect(User.findOneAndUpdate.mock.calls[0][0].passwordResetTokenExpiresAt.$gt).toBeInstanceOf(Date);
    expect(RefreshSession.updateMany).not.toHaveBeenCalled();
  });

  it('allows only one of two simultaneous password resets with the same token', async () => {
    const resetToken = crypto.randomBytes(32).toString('base64url');
    let tokenConsumed = false;
    bcrypt.hash.mockResolvedValue('new-secure-password-hash');
    User.findOneAndUpdate.mockImplementation(async () => {
      if (tokenConsumed) return null;
      tokenConsumed = true;
      return { _id: 'user123' };
    });
    const requests = [1, 2].map(() => ({
      req: httpMocks.createRequest({
        body: { email: 'coach@example.com', resetToken, newPassword: 'NewPassword1!' }
      }),
      res: httpMocks.createResponse()
    }));

    await Promise.all(requests.map(({ req, res }) => resetPassword(req, res)));

    expect(requests.map(({ res }) => res.statusCode).sort()).toEqual([200, 400]);
    expect(RefreshSession.updateMany).toHaveBeenCalledTimes(1);
  });

  it('rejects refresh sessions created before the password reset', async () => {
    const passwordChangedAt = new Date(Date.now() - 5_000);
    const session = {
      userId: 'user123',
      familyId: 'family123',
      createdAt: new Date(passwordChangedAt.getTime() - 1_000)
    };
    RefreshSession.findOneAndUpdate.mockReturnValue({ select: jest.fn().mockResolvedValue(session) });
    User.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({ _id: 'user123', passwordChangedAt })
    });
    const req = httpMocks.createRequest({ cookies: { refreshToken: 'old-refresh-token' } });
    const res = httpMocks.createResponse();

    await refreshSession(req, res);

    expect(res.statusCode).toBe(401);
    expect(RefreshSession.updateMany).toHaveBeenCalledWith(
      { userId: 'user123', familyId: 'family123', revokedAt: null },
      { $set: { revokedAt: expect.any(Date) } }
    );
  });

  it('reports refresh persistence failures as temporary server errors', async () => {
    RefreshSession.findOneAndUpdate.mockReturnValue({
      select: jest.fn().mockRejectedValue(new Error('database unavailable'))
    });
    const req = httpMocks.createRequest({ cookies: { refreshToken: 'valid-refresh-token' } });
    const res = httpMocks.createResponse();

    await refreshSession(req, res);

    expect(res.statusCode).toBe(500);
    expect(res._getJSONData()).toEqual({
      success: false,
      message: 'Unable to refresh session. Please try again later.'
    });
    expect(res.get('Set-Cookie')).toBeUndefined();
  });

  it('continues to rotate a valid refresh session when the password is unchanged', async () => {
    const session = {
      userId: 'user123',
      familyId: 'family123',
      createdAt: new Date(Date.now() - 10_000),
      save: jest.fn().mockResolvedValue(true)
    };
    const user = { _id: 'user123', role: 'student', passwordChangedAt: null };
    RefreshSession.findOneAndUpdate.mockReturnValue({ select: jest.fn().mockResolvedValue(session) });
    User.findById
      .mockReturnValueOnce({ select: jest.fn().mockResolvedValue(user) })
      .mockReturnValueOnce({ select: jest.fn().mockResolvedValue(user) });
    const req = httpMocks.createRequest({ cookies: { refreshToken: 'valid-refresh-token' } });
    const res = httpMocks.createResponse();

    await refreshSession(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._getJSONData().success).toBe(true);
    expect(RefreshSession.create).toHaveBeenCalledTimes(1);
    expect(session.save).toHaveBeenCalled();
    expect(RefreshSession.updateOne).not.toHaveBeenCalled();
  });

  it('rotates only the refresh cookie for the active portal role', async () => {
    const session = {
      userId: 'admin-user',
      familyId: 'admin-family',
      createdAt: new Date(Date.now() - 10_000),
      save: jest.fn().mockResolvedValue(true)
    };
    const user = { _id: 'admin-user', role: 'admin', passwordChangedAt: null };
    RefreshSession.findOneAndUpdate.mockReturnValue({ select: jest.fn().mockResolvedValue(session) });
    User.findById
      .mockReturnValueOnce({ select: jest.fn().mockResolvedValue(user) })
      .mockReturnValueOnce({ select: jest.fn().mockResolvedValue(user) });
    const req = httpMocks.createRequest({
      headers: { 'x-portal-role': 'admin' },
      cookies: {
        refreshToken_admin: 'admin-refresh-token',
        refreshToken_student: 'student-refresh-token',
      },
    });
    const res = httpMocks.createResponse();
    const setCookie = jest.spyOn(res, 'cookie');

    await refreshSession(req, res);

    expect(res.statusCode).toBe(200);
    expect(RefreshSession.findOneAndUpdate.mock.calls[0][0].tokenHash)
      .toBe(hashRefreshToken('admin-refresh-token'));
    expect(setCookie.mock.calls.map(([name]) => name)).toEqual([
      'accessToken_admin', 'refreshToken_admin', 'csrfToken_admin',
    ]);
  });

  it('logs out only the selected portal refresh session', async () => {
    RefreshSession.updateOne.mockResolvedValue({ modifiedCount: 1 });
    const req = httpMocks.createRequest({
      headers: { 'x-portal-role': 'admin' },
      cookies: {
        refreshToken_admin: 'admin-refresh-token',
        refreshToken_student: 'student-refresh-token',
      },
    });
    const res = httpMocks.createResponse();
    const clearCookie = jest.spyOn(res, 'clearCookie');

    await logout(req, res);

    expect(res.statusCode).toBe(200);
    expect(RefreshSession.updateOne.mock.calls[0][0].tokenHash)
      .toBe(hashRefreshToken('admin-refresh-token'));
    expect(clearCookie.mock.calls.map(([name]) => name)).toEqual([
      'accessToken_admin', 'accessToken',
      'refreshToken_admin', 'refreshToken',
      'csrfToken_admin', 'csrfToken',
    ]);
  });

  it('does not consume a legacy refresh token belonging to another portal role', async () => {
    RefreshSession.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ userId: 'student-user' })
      })
    });
    User.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ role: 'student', accountStatus: 'active' })
      })
    });
    const req = httpMocks.createRequest({
      headers: { 'x-portal-role': 'admin' },
      cookies: { refreshToken: 'legacy-student-refresh-token' },
    });
    const res = httpMocks.createResponse();

    await refreshSession(req, res);

    expect(res.statusCode).toBe(401);
    expect(RefreshSession.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('does not issue a rotated refresh session if password changes during refresh', async () => {
    const sessionCreatedAt = new Date(Date.now() - 10_000);
    const passwordChangedAt = new Date(Date.now() - 1_000);
    const session = {
      userId: 'user123',
      familyId: 'family123',
      createdAt: sessionCreatedAt,
      save: jest.fn().mockResolvedValue(true)
    };
    RefreshSession.findOneAndUpdate.mockReturnValue({ select: jest.fn().mockResolvedValue(session) });
    User.findById
      .mockReturnValueOnce({
        select: jest.fn().mockResolvedValue({ _id: 'user123', passwordChangedAt: null })
      })
      .mockReturnValueOnce({
        select: jest.fn().mockResolvedValue({ _id: 'user123', passwordChangedAt })
      });
    const req = httpMocks.createRequest({ cookies: { refreshToken: 'refresh-token' } });
    const res = httpMocks.createResponse();

    await refreshSession(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.get('Set-Cookie')).toBeUndefined();
    expect(RefreshSession.updateOne).toHaveBeenCalledWith(
      { tokenHash: expect.any(String), revokedAt: null },
      { $set: { revokedAt: expect.any(Date) } }
    );
  });

  it('continues to support logout and revoke its refresh session', async () => {
    RefreshSession.updateOne.mockResolvedValue({ modifiedCount: 1 });
    const req = httpMocks.createRequest({ cookies: { refreshToken: 'refresh-token-to-revoke' } });
    const res = httpMocks.createResponse();

    await logout(req, res);

    expect(res.statusCode).toBe(200);
    expect(RefreshSession.updateOne).toHaveBeenCalledWith(
      { tokenHash: expect.any(String), revokedAt: null },
      { $set: { revokedAt: expect.any(Date) } }
    );
  });

  it('reports failed refresh-session revocation and still clears authentication cookies', async () => {
    RefreshSession.updateOne.mockRejectedValue(new Error('database unavailable'));
    const req = httpMocks.createRequest({ cookies: { refreshToken: 'refresh-token-to-revoke' } });
    const res = httpMocks.createResponse();
    const clearCookie = jest.spyOn(res, 'clearCookie');

    await logout(req, res);

    expect(res.statusCode).toBe(500);
    expect(res._getJSONData()).toEqual({
      success: false,
      message: 'Unable to log out. Please try again later.'
    });
    expect(clearCookie).toHaveBeenCalledTimes(3);
  });
});
