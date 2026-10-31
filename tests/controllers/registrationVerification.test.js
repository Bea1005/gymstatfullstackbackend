process.env.JWT_SECRET = 'registration-verification-test-secret';

const httpMocks = require('node-mocks-http');
const crypto = require('crypto');
const User = require('../../src/models/User');
const PendingRegistration = require('../../src/models/PendingRegistration');
const {
  register,
  resendRegistrationOtp,
  verifyRegistrationOtp,
} = require('../../src/controllers/authControllers');
const {
  sendRegistrationVerificationOtp,
} = require('../../src/config/email');
const {
  sendContactVerificationOtp,
} = require('../../src/config/sms');

jest.mock('../../src/models/User', () => ({
  findOne: jest.fn(),
  create: jest.fn(),
}));
jest.mock('../../src/models/PendingRegistration', () => ({
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  create: jest.fn(),
  deleteOne: jest.fn(),
  updateOne: jest.fn(),
}));
jest.mock('../../src/models/RefreshSession', () => ({
  updateMany: jest.fn(),
}));
jest.mock('../../src/config/passwords', () => ({
  hashPassword: jest.fn().mockResolvedValue('hashed-registration-password'),
  verifyPassword: jest.fn(),
  isPasswordValid: jest.fn().mockReturnValue(true),
  PASSWORD_POLICY_MESSAGE: 'Password is invalid.',
}));
jest.mock('../../src/config/email', () => ({
  getRegistrationEmailFailure: jest.fn(),
  sendPasswordResetOtp: jest.fn(),
  sendRegistrationVerificationOtp: jest.fn().mockResolvedValue(true),
  sendScreenerAccountCreatedEmail: jest.fn(),
}));
jest.mock('../../src/config/sms', () => ({
  ...jest.requireActual('../../src/config/sms'),
  sendContactVerificationOtp: jest.fn().mockResolvedValue(true),
}));

const hashOtp = (otp) => crypto
  .createHmac('sha256', process.env.JWT_SECRET)
  .update(String(otp))
  .digest('hex');

const validRegistration = (overrides = {}) => ({
  fullname: 'Jane Doe',
  email: 'jane@example.com',
  contactNumber: '09171234567',
  password: 'Password1!',
  department: 'CICS',
  sport: 'Basketball',
  sports: ['Basketball'],
  id: '23B1509',
  verificationMethod: 'sms',
  ...overrides,
});

describe('registration identity verification', () => {
  let pendingDocument;

  beforeEach(() => {
    jest.clearAllMocks();
    pendingDocument = null;
    User.findOne.mockResolvedValue(null);
    User.create.mockImplementation(async (user) => ({ _id: 'created-user', ...user }));
    PendingRegistration.findOne.mockImplementation(() => ({
      select: jest.fn().mockResolvedValue(null),
    }));
    PendingRegistration.create.mockImplementation(async (payload) => {
      pendingDocument = { _id: 'pending-registration', ...payload };
      return pendingDocument;
    });
    PendingRegistration.deleteOne.mockResolvedValue({ deletedCount: 1 });
    PendingRegistration.findOneAndUpdate.mockResolvedValue(null);
    PendingRegistration.updateOne.mockResolvedValue({ modifiedCount: 1 });
  });

  it('stores a normalized contact number and sends only the selected SMS OTP', async () => {
    const req = httpMocks.createRequest({ body: validRegistration() });
    const res = httpMocks.createResponse();

    await register(req, res);

    expect(res.statusCode).toBe(201);
    expect(PendingRegistration.create).toHaveBeenCalledWith(expect.objectContaining({
      contactNumber: '+639171234567',
      verificationMethod: 'sms',
      registrationOtpHash: null,
      contactOtpHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      role: 'student',
    }));
    expect(sendContactVerificationOtp).toHaveBeenCalledWith(
      '+639171234567',
      expect.stringMatching(/^\d{6}$/),
      5
    );
    expect(sendRegistrationVerificationOtp).not.toHaveBeenCalled();
    expect(res._getJSONData()).not.toHaveProperty('otp');
    expect(User.create).not.toHaveBeenCalled();
  });

  it('sends email verification only when email is selected', async () => {
    const req = httpMocks.createRequest({
      body: validRegistration({ verificationMethod: 'email' }),
    });
    const res = httpMocks.createResponse();

    await register(req, res);

    expect(res.statusCode).toBe(201);
    expect(pendingDocument.contactNumber).toBe('+639171234567');
    expect(pendingDocument.contactOtpHash).toBeNull();
    expect(pendingDocument.registrationOtpHash).toMatch(/^[a-f0-9]{64}$/);
    expect(sendRegistrationVerificationOtp).toHaveBeenCalledWith(
      'jane@example.com',
      expect.stringMatching(/^\d{6}$/),
      10
    );
    expect(sendContactVerificationOtp).not.toHaveBeenCalled();
  });

  it('does not retain an unverified registration when SMS delivery fails', async () => {
    sendContactVerificationOtp.mockRejectedValueOnce(new Error('SMS provider unavailable'));
    const res = httpMocks.createResponse();

    await register(httpMocks.createRequest({ body: validRegistration() }), res);

    expect(res.statusCode).toBe(503);
    expect(res._getJSONData().message).toContain('SMS provider unavailable');
    expect(PendingRegistration.deleteOne).toHaveBeenCalledWith({ _id: 'pending-registration' });
    expect(User.create).not.toHaveBeenCalled();
  });

  it('creates an email-verified account only after email OTP verification', async () => {
    const registrationRes = httpMocks.createResponse();
    await register(httpMocks.createRequest({
      body: validRegistration({ verificationMethod: 'email' }),
    }), registrationRes);
    const otp = sendRegistrationVerificationOtp.mock.calls[0][1];
    PendingRegistration.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue(pendingDocument),
    });
    const verifyRes = httpMocks.createResponse();

    await verifyRegistrationOtp(httpMocks.createRequest({
      body: { email: 'jane@example.com', otp, verificationMethod: 'email' },
    }), verifyRes);

    expect(verifyRes.statusCode).toBe(200);
    expect(User.create).toHaveBeenCalledWith(expect.objectContaining({
      contactNumber: '+639171234567',
      emailVerified: true,
      contactNumberVerified: false,
      verificationMethod: 'email',
    }));
    expect(PendingRegistration.deleteOne).toHaveBeenCalledWith({ _id: 'pending-registration' });
  });

  it.each(['0917123456', '08171234567', '+638171234567', '0917 123 4567', ''])(
    'rejects invalid contact number %s before creating a pending registration',
    async (contactNumber) => {
      const req = httpMocks.createRequest({
        body: validRegistration({ contactNumber }),
      });
      const res = httpMocks.createResponse();

      await register(req, res);

      expect(res.statusCode).toBe(400);
      expect(res._getJSONData().message).toContain('Philippine mobile number');
      expect(PendingRegistration.create).not.toHaveBeenCalled();
      expect(sendContactVerificationOtp).not.toHaveBeenCalled();
    }
  );

  it('creates one SMS-verified user with the saved contact number after a valid OTP', async () => {
    const registrationRes = httpMocks.createResponse();
    await register(httpMocks.createRequest({ body: validRegistration() }), registrationRes);
    const otp = sendContactVerificationOtp.mock.calls[0][1];
    PendingRegistration.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue(pendingDocument),
    });
    const verifyRes = httpMocks.createResponse();

    await verifyRegistrationOtp(httpMocks.createRequest({
      body: {
        email: 'jane@example.com',
        otp,
        verificationMethod: 'sms',
        contactNumber: '+639000000000',
      },
    }), verifyRes);

    expect(verifyRes.statusCode).toBe(200);
    expect(User.create).toHaveBeenCalledWith(expect.objectContaining({
      email: 'jane@example.com',
      contactNumber: '+639171234567',
      emailVerified: false,
      contactNumberVerified: true,
      verificationMethod: 'sms',
    }));
    expect(PendingRegistration.deleteOne).toHaveBeenCalledWith({ _id: 'pending-registration' });
  });

  it('does not create an account when a verification request selects the wrong method', async () => {
    pendingDocument = {
      _id: 'pending-registration',
      email: 'jane@example.com',
      verificationMethod: 'sms',
      contactNumber: '+639171234567',
      contactOtpHash: hashOtp('012345'),
      contactOtpExpiresAt: new Date(Date.now() + 60_000),
      contactOtpAttempts: 0,
    };
    PendingRegistration.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue(pendingDocument),
    });
    const res = httpMocks.createResponse();

    await verifyRegistrationOtp(httpMocks.createRequest({
      body: {
        email: 'jane@example.com',
        otp: '012345',
        verificationMethod: 'email',
      },
    }), res);

    expect(res.statusCode).toBe(400);
    expect(User.create).not.toHaveBeenCalled();
  });

  it('deletes an expired OTP registration without creating a user', async () => {
    const expiredRegistration = {
      _id: 'expired-registration',
      email: 'jane@example.com',
      verificationMethod: 'sms',
      contactNumber: '+639171234567',
      contactOtpHash: hashOtp('012345'),
      contactOtpExpiresAt: new Date(Date.now() - 1),
      contactOtpAttempts: 0,
    };
    PendingRegistration.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue(expiredRegistration),
    });
    const res = httpMocks.createResponse();

    await verifyRegistrationOtp(httpMocks.createRequest({
      body: { email: 'jane@example.com', otp: '012345', verificationMethod: 'sms' },
    }), res);

    expect(res.statusCode).toBe(400);
    expect(res._getJSONData().message).toContain('expired');
    expect(PendingRegistration.deleteOne).toHaveBeenCalledWith({ _id: 'expired-registration' });
    expect(User.create).not.toHaveBeenCalled();
  });

  it('counts an incorrect SMS OTP attempt and does not create an account', async () => {
    const pending = {
      _id: 'pending-registration',
      email: 'jane@example.com',
      verificationMethod: 'sms',
      contactNumber: '+639171234567',
      contactOtpHash: hashOtp('123456'),
      contactOtpExpiresAt: new Date(Date.now() + 60_000),
      contactOtpAttempts: 0,
    };
    PendingRegistration.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue(pending),
    });
    const res = httpMocks.createResponse();

    await verifyRegistrationOtp(httpMocks.createRequest({
      body: { email: 'jane@example.com', otp: '000000', verificationMethod: 'sms' },
    }), res);

    expect(res.statusCode).toBe(400);
    expect(PendingRegistration.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'pending-registration' },
      { $inc: { contactOtpAttempts: 1 } },
      { new: true }
    );
    expect(User.create).not.toHaveBeenCalled();
  });

  it('applies the SMS resend cooldown and does not send another OTP', async () => {
    const pending = {
      _id: 'pending-registration',
      email: 'jane@example.com',
      verificationMethod: 'sms',
      contactNumber: '+639171234567',
      contactOtpLastSentAt: new Date(Date.now() - 30_000),
      contactOtpResendCount: 0,
      registrationOtpResendCount: 0,
    };
    PendingRegistration.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue(pending),
    });
    const res = httpMocks.createResponse();

    await resendRegistrationOtp(httpMocks.createRequest({
      body: { email: 'jane@example.com', verificationMethod: 'sms' },
    }), res);

    expect(res.statusCode).toBe(429);
    expect(res.getHeader('Retry-After')).toBeDefined();
    expect(PendingRegistration.findOneAndUpdate).not.toHaveBeenCalled();
    expect(sendContactVerificationOtp).not.toHaveBeenCalled();
  });

  it('limits total resend requests across verification methods', async () => {
    const pending = {
      _id: 'pending-registration',
      email: 'jane@example.com',
      verificationMethod: 'email',
      registrationOtpLastSentAt: new Date(Date.now() - 61_000),
      contactOtpLastSentAt: new Date(Date.now() - 61_000),
      contactOtpResendCount: 3,
      registrationOtpResendCount: 2,
      expiresAt: new Date(Date.now() + 60_000),
    };
    PendingRegistration.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue(pending),
    });
    const res = httpMocks.createResponse();

    await resendRegistrationOtp(httpMocks.createRequest({
      body: { email: 'jane@example.com', verificationMethod: 'email' },
    }), res);

    expect(res.statusCode).toBe(429);
    expect(PendingRegistration.findOneAndUpdate).not.toHaveBeenCalled();
    expect(sendRegistrationVerificationOtp).not.toHaveBeenCalled();
    expect(sendContactVerificationOtp).not.toHaveBeenCalled();
  });

  it('switches the pending registration to email and invalidates the SMS OTP', async () => {
    const pending = {
      _id: 'pending-registration',
      email: 'jane@example.com',
      verificationMethod: 'sms',
      contactNumber: '+639171234567',
      contactOtpHash: 'old-sms-hash',
      contactOtpExpiresAt: new Date(Date.now() + 60_000),
      contactOtpLastSentAt: new Date(),
      contactOtpResendCount: 0,
      registrationOtpLastSentAt: null,
      registrationOtpResendCount: 0,
    };
    PendingRegistration.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue(pending),
    });
    PendingRegistration.findOneAndUpdate.mockResolvedValue(pending);
    const res = httpMocks.createResponse();

    await resendRegistrationOtp(httpMocks.createRequest({
      body: {
        email: 'jane@example.com',
        verificationMethod: 'email',
        contactNumber: '+639000000000',
      },
    }), res);

    expect(res.statusCode).toBe(202);
    expect(PendingRegistration.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'pending-registration' }),
      expect.objectContaining({
        $set: expect.objectContaining({
          verificationMethod: 'email',
          contactOtpHash: null,
          registrationOtpHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          contactOtpLastSentAt: pending.contactOtpLastSentAt,
        }),
      }),
      { new: true }
    );
    expect(sendRegistrationVerificationOtp).toHaveBeenCalledWith(
      'jane@example.com',
      expect.stringMatching(/^\d{6}$/),
      10
    );
    expect(sendContactVerificationOtp).not.toHaveBeenCalled();
  });

  it('rejects a contact number already associated with a permanent account', async () => {
    User.findOne.mockResolvedValue({
      id: 'existing-id',
      contactNumber: '+639171234567',
    });
    const res = httpMocks.createResponse();

    await register(httpMocks.createRequest({ body: validRegistration() }), res);

    expect(res.statusCode).toBe(409);
    expect(res._getJSONData().message).toContain('contact number');
    expect(PendingRegistration.create).not.toHaveBeenCalled();
    expect(sendContactVerificationOtp).not.toHaveBeenCalled();
  });

  it('does not create a second user when a successful verification is repeated', async () => {
    const registrationRes = httpMocks.createResponse();
    await register(httpMocks.createRequest({ body: validRegistration() }), registrationRes);
    const otp = sendContactVerificationOtp.mock.calls[0][1];
    PendingRegistration.findOne
      .mockReturnValueOnce({ select: jest.fn().mockResolvedValue(pendingDocument) })
      .mockReturnValueOnce({ select: jest.fn().mockResolvedValue(null) });
    const firstRes = httpMocks.createResponse();
    const secondRes = httpMocks.createResponse();
    const verifyRequest = () => httpMocks.createRequest({
      body: { email: 'jane@example.com', otp, verificationMethod: 'sms' },
    });

    await verifyRegistrationOtp(verifyRequest(), firstRes);
    await verifyRegistrationOtp(verifyRequest(), secondRes);

    expect(firstRes.statusCode).toBe(200);
    expect(secondRes.statusCode).toBe(400);
    expect(User.create).toHaveBeenCalledTimes(1);
  });
});
