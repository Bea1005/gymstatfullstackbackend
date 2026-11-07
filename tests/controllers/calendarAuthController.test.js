const crypto = require('crypto');
const httpMocks = require('node-mocks-http');
const PendingRegistration = require('../../src/models/PendingRegistration');
const User = require('../../src/models/User');
const { sendRegistrationVerificationOtp } = require('../../src/config/email');
const { register, verifyRegistration } = require('../../src/controllers/calendarAuthController');

jest.mock('../../src/models/PendingRegistration', () => ({
  create: jest.fn(),
  deleteOne: jest.fn(),
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));
jest.mock('../../src/models/User', () => ({
  create: jest.fn(),
  findOne: jest.fn(),
  hasRegisteredEmail: jest.fn(),
  ensureEmailIndex: jest.fn().mockResolvedValue('emailNormalized_1'),
  ensureGoogleIndex: jest.fn().mockResolvedValue('googleSub_1'),
}));
jest.mock('../../src/config/passwords', () => ({
  hashPassword: jest.fn().mockResolvedValue('stored-password-hash'),
  verifyPassword: jest.fn(),
  isPasswordValid: jest.fn((password) => password === 'ValidPassword1!'),
  PASSWORD_POLICY_MESSAGE: 'Password policy error',
}));
jest.mock('../../src/config/security', () => ({
  getJWTSecret: jest.fn(() => 'calendar-test-secret'),
}));
jest.mock('../../src/config/email', () => ({
  getRegistrationEmailFailure: jest.fn(() => ({ message: 'Verification email unavailable.' })),
  sendRegistrationVerificationOtp: jest.fn(),
}));
jest.mock('../../src/config/authTokens', () => ({
  createAccessToken: jest.fn(() => 'calendar-access-token'),
  createRefreshSession: jest.fn().mockResolvedValue({ refreshToken: 'calendar-refresh-token' }),
  setAuthenticationCookies: jest.fn(),
}));

describe('Public Calendar authentication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    User.hasRegisteredEmail.mockResolvedValue(false);
    User.findOne.mockResolvedValue(null);
    PendingRegistration.findOne.mockResolvedValue(null);
    PendingRegistration.deleteOne.mockResolvedValue({ deletedCount: 1 });
    sendRegistrationVerificationOtp.mockResolvedValue(undefined);
  });

  it('stores a pending registration and does not create a user before email verification', async () => {
    PendingRegistration.create.mockResolvedValue({ _id: 'pending-id' });
    const req = httpMocks.createRequest({
      body: {
        firstName: 'Jane',
        middleName: 'Marie',
        lastName: 'Doe',
        email: 'Jane.Doe@example.com',
        phoneNumber: '09171234567',
        password: 'ValidPassword1!',
      },
    });
    const res = httpMocks.createResponse();

    await register(req, res);

    expect(res.statusCode).toBe(202);
    expect(PendingRegistration.create).toHaveBeenCalledWith(expect.objectContaining({
      fullname: 'Jane Marie Doe',
      emailNormalized: 'jane.doe@example.com',
      contactNumber: '+639171234567',
      role: 'calendar',
      emailVerified: false,
      password: 'stored-password-hash',
    }));
    expect(sendRegistrationVerificationOtp).toHaveBeenCalledWith(
      'jane.doe@example.com',
      expect.stringMatching(/^\d{6}$/),
      10
    );
    expect(User.create).not.toHaveBeenCalled();
  });

  it('creates an active account only after consuming a valid, unexpired OTP', async () => {
    const otp = '123456';
    const otpHash = crypto.createHmac('sha256', 'calendar-test-secret').update(otp).digest('hex');
    const pending = {
      _id: 'pending-id',
      id: 'calendar-random-id',
      role: 'calendar',
      fullname: 'Jane Doe',
      email: 'jane@marsu.edu.ph',
      emailNormalized: 'jane@marsu.edu.ph',
      contactNumber: '+639171234567',
      password: 'stored-password-hash',
      emailVerified: false,
      registrationOtpHash: otpHash,
      registrationOtpExpiresAt: new Date(Date.now() + 60_000),
      registrationOtpAttempts: 0,
      expiresAt: new Date(Date.now() + 60_000),
    };
    const verifiedPending = { ...pending, emailVerified: true, registrationOtpHash: null };
    const createdUser = {
      _id: 'user-id',
      id: pending.id,
      role: 'calendar',
      fullname: pending.fullname,
      email: pending.email,
      contactNumber: pending.contactNumber,
      emailVerified: true,
    };
    PendingRegistration.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue(pending),
    });
    PendingRegistration.findOneAndUpdate.mockResolvedValue(verifiedPending);
    User.create.mockResolvedValue(createdUser);

    const req = httpMocks.createRequest({ body: { email: pending.email, otp } });
    const res = httpMocks.createResponse();

    await verifyRegistration(req, res);

    expect(PendingRegistration.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: pending._id,
        role: 'calendar',
        registrationOtpHash: otpHash,
        registrationOtpExpiresAt: { $gt: expect.any(Date) },
        emailVerified: false,
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          emailVerified: true,
          registrationOtpHash: null,
        }),
      }),
      { new: true }
    );
    expect(User.create).toHaveBeenCalledWith(expect.objectContaining({
      email: pending.email,
      emailVerified: true,
      accountType: 'Internal',
      role: 'calendar',
      contactNumber: pending.contactNumber,
    }));
    expect(PendingRegistration.deleteOne).toHaveBeenCalledWith({ _id: pending._id });
    expect(res.statusCode).toBe(200);
    expect(res._getJSONData()).toMatchObject({
      success: true,
      user: { role: 'calendar', accountType: 'Internal' },
      needsProfileCompletion: false,
    });
  });
});

// ── Google Sign-In (googleLogin) tests ────────────────────────────────────────

// Pull in googleLogin separately so we can control GOOGLE_CLIENT_ID per-test.
// The controller reads process.env.GOOGLE_CLIENT_ID at call time (not at import
// time), so patching process.env is sufficient.

jest.mock('google-auth-library', () => {
  const verifyIdToken = jest.fn();
  return {
    OAuth2Client: jest.fn().mockImplementation(() => ({ verifyIdToken })),
    __verifyIdToken: verifyIdToken,
  };
});

const { OAuth2Client, __verifyIdToken: verifyIdToken } = require('google-auth-library');
const { googleLogin } = require('../../src/controllers/calendarAuthController');

const VALID_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
const VALID_GOOGLE_SUB = 'google-sub-123';
const VALID_EMAIL = 'external@gmail.com';
const VALID_CREDENTIAL = 'valid-id-token';

const makeGoogleReq = (body = {}) => httpMocks.createRequest({ body });
const makeGooglePayload = (overrides = {}) => ({
  sub: VALID_GOOGLE_SUB,
  email: VALID_EMAIL,
  email_verified: true,
  name: 'Test External User',
  ...overrides,
});

describe('Google Sign-In — googleLogin', () => {
  let savedClientId;

  beforeEach(() => {
    jest.clearAllMocks();
    savedClientId = process.env.GOOGLE_CLIENT_ID;
    process.env.GOOGLE_CLIENT_ID = VALID_CLIENT_ID;
    User.hasRegisteredEmail.mockResolvedValue(false);
    User.findOne.mockResolvedValue(null);
    User.ensureEmailIndex.mockResolvedValue();
    User.ensureGoogleIndex.mockResolvedValue();
  });

  afterEach(() => {
    if (savedClientId === undefined) {
      delete process.env.GOOGLE_CLIENT_ID;
    } else {
      process.env.GOOGLE_CLIENT_ID = savedClientId;
    }
  });

  // ── Configuration checks ────────────────────────────────────────────────────

  it('returns 503 when GOOGLE_CLIENT_ID is not set', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const req = makeGoogleReq({ credential: VALID_CREDENTIAL });
    const res = httpMocks.createResponse();

    await googleLogin(req, res);

    expect(res.statusCode).toBe(503);
    expect(res._getJSONData()).toMatchObject({
      success: false,
      message: expect.stringContaining('not configured'),
    });
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it('returns 503 when GOOGLE_CLIENT_ID is an empty string', async () => {
    process.env.GOOGLE_CLIENT_ID = '';
    const req = makeGoogleReq({ credential: VALID_CREDENTIAL });
    const res = httpMocks.createResponse();

    await googleLogin(req, res);

    expect(res.statusCode).toBe(503);
    expect(res._getJSONData().success).toBe(false);
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it('returns 503 when GOOGLE_CLIENT_ID is only whitespace', async () => {
    process.env.GOOGLE_CLIENT_ID = '   ';
    const req = makeGoogleReq({ credential: VALID_CREDENTIAL });
    const res = httpMocks.createResponse();

    await googleLogin(req, res);

    expect(res.statusCode).toBe(503);
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it('returns 400 when credential is missing', async () => {
    const req = makeGoogleReq({});
    const res = httpMocks.createResponse();

    await googleLogin(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._getJSONData().success).toBe(false);
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  // ── New-user creation ───────────────────────────────────────────────────────

  it('creates a new calendar user and issues a session when the Google token is valid', async () => {
    const payload = makeGooglePayload();
    verifyIdToken.mockResolvedValue({ getPayload: () => payload });
    const createdUser = {
      _id: 'new-user-id',
      id: 'calendar-hex',
      role: 'calendar',
      email: VALID_EMAIL,
      fullname: 'Test External User',
      contactNumber: '',
      emailVerified: true,
      googleSub: VALID_GOOGLE_SUB,
      save: jest.fn().mockResolvedValue(undefined),
    };
    // Controller calls: findOne({ googleSub }).select('+googleSub') → null (no existing)
    // then findUserByEmail → findOne({ $or: [...] }) → null (no existing by email)
    const selectMock = jest.fn().mockResolvedValue(null);
    User.findOne.mockReturnValue({ select: selectMock });
    User.create.mockResolvedValue(createdUser);

    const req = makeGoogleReq({ credential: VALID_CREDENTIAL });
    const res = httpMocks.createResponse();

    await googleLogin(req, res);

    expect(verifyIdToken).toHaveBeenCalledWith({
      idToken: VALID_CREDENTIAL,
      audience: VALID_CLIENT_ID,
    });
    expect(User.create).toHaveBeenCalledWith(expect.objectContaining({
      email: VALID_EMAIL,
      emailVerified: true,
      role: 'calendar',
      googleSub: VALID_GOOGLE_SUB,
    }));
    expect(res.statusCode).toBe(200);
    const body = res._getJSONData();
    expect(body.success).toBe(true);
    expect(body.needsProfileCompletion).toBe(true); // contactNumber is empty
  });

  it('marks profile completion as not required when the user has a phone number', async () => {
    const payload = makeGooglePayload();
    verifyIdToken.mockResolvedValue({ getPayload: () => payload });
    const existingUser = {
      _id: 'existing-id',
      id: 'calendar-hex',
      role: 'calendar',
      email: VALID_EMAIL,
      fullname: 'Test External User',
      contactNumber: '+639171234567',
      emailVerified: true,
      googleSub: VALID_GOOGLE_SUB,
      accountStatus: 'active',
      save: jest.fn().mockResolvedValue(undefined),
    };
    // First findOne (by googleSub) uses .select() chaining
    User.findOne
      .mockReturnValueOnce({ select: jest.fn().mockResolvedValue(existingUser) })
      .mockReturnValue({ select: jest.fn().mockResolvedValue(null) });

    const req = makeGoogleReq({ credential: VALID_CREDENTIAL });
    const res = httpMocks.createResponse();

    await googleLogin(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._getJSONData().needsProfileCompletion).toBe(false);
  });

  // ── Token-verification failures ─────────────────────────────────────────────

  it('returns 401 when verifyIdToken rejects the token', async () => {
    verifyIdToken.mockRejectedValue(new Error('Token signature invalid'));

    const req = makeGoogleReq({ credential: 'bad-token' });
    const res = httpMocks.createResponse();

    await googleLogin(req, res);

    expect(res.statusCode).toBe(401);
    expect(res._getJSONData().success).toBe(false);
  });

  it('returns 401 when the Google payload has email_verified false', async () => {
    verifyIdToken.mockResolvedValue({ getPayload: () => makeGooglePayload({ email_verified: false }) });

    const req = makeGoogleReq({ credential: VALID_CREDENTIAL });
    const res = httpMocks.createResponse();

    await googleLogin(req, res);

    expect(res.statusCode).toBe(401);
    expect(res._getJSONData().success).toBe(false);
  });

  it('returns 401 when the Google payload has no sub', async () => {
    verifyIdToken.mockResolvedValue({ getPayload: () => makeGooglePayload({ sub: '' }) });

    const req = makeGoogleReq({ credential: VALID_CREDENTIAL });
    const res = httpMocks.createResponse();

    await googleLogin(req, res);

    expect(res.statusCode).toBe(401);
  });

  // ── Archived account ────────────────────────────────────────────────────────

  it('returns 403 when the matched user account is archived', async () => {
    const archivedUser = {
      _id: 'archived-id',
      role: 'calendar',
      email: VALID_EMAIL,
      accountStatus: 'archived',
      googleSub: VALID_GOOGLE_SUB,
    };
    verifyIdToken.mockResolvedValue({ getPayload: () => makeGooglePayload() });
    // First findOne (by googleSub) returns the archived user via .select()
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(archivedUser) });

    const req = makeGoogleReq({ credential: VALID_CREDENTIAL });
    const res = httpMocks.createResponse();

    await googleLogin(req, res);

    expect(res.statusCode).toBe(403);
    expect(res._getJSONData().success).toBe(false);
  });

  // ── Email-and-password login is unaffected ──────────────────────────────────

  it('email-and-password login still works when GOOGLE_CLIENT_ID is missing', async () => {
    // Import login separately; it does not read GOOGLE_CLIENT_ID at all.
    const { login } = require('../../src/controllers/calendarAuthController');
    delete process.env.GOOGLE_CLIENT_ID;

    const { verifyPassword } = require('../../src/config/passwords');
    const user = {
      _id: 'user-id',
      id: 'u1',
      role: 'calendar',
      email: 'internal@marsu.edu.ph',
      fullname: 'Internal User',
      contactNumber: '+639171234567',
      emailVerified: true,
      accountStatus: 'active',
      password: 'hashed-pw',
      save: jest.fn().mockResolvedValue(undefined),
    };
    User.findOne.mockResolvedValue(user);
    verifyPassword.mockResolvedValue({ valid: true, needsRehash: false });

    const req = httpMocks.createRequest({ body: { email: user.email, password: 'ValidPassword1!' } });
    const res = httpMocks.createResponse();

    await login(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._getJSONData().success).toBe(true);
  });
});
