const User = require('../models/User');
const crypto = require('crypto');
const { getJWTSecret } = require('../config/security');
const { hashPassword, verifyPassword, isPasswordValid, PASSWORD_POLICY_MESSAGE } = require('../config/passwords');
const {
  getRegistrationEmailFailure,
  sendPasswordResetOtp,
  sendRegistrationVerificationOtp,
  sendScreenerAccountCreatedEmail
} = require('../config/email');
const RefreshSession = require('../models/RefreshSession');
const PendingRegistration = require('../models/PendingRegistration');
const {
  createAccessToken,
  createRefreshSession,
  hashRefreshToken,
  getAuthCookie,
  getPortalRole,
  normalizePortalRole,
  setAuthenticationCookies,
  clearAuthenticationCookies,
  REFRESH_COOKIE_NAME,
} = require('../config/authTokens');

const RESET_OTP_TTL_MS = 10 * 60 * 1000;
const RESET_OTP_COOLDOWN_MS = 60 * 1000;
const RESET_OTP_MAX_ATTEMPTS = 5;
const RESET_TOKEN_TTL_MS = 10 * 60 * 1000;
const REGISTRATION_OTP_TTL_MS = 10 * 60 * 1000;
const REGISTRATION_OTP_COOLDOWN_MS = 60 * 1000;
const REGISTRATION_OTP_MAX_ATTEMPTS = 5;
const REGISTRATION_OTP_MAX_RESENDS = 5;
const GENERIC_RESET_MESSAGE = 'If an account is associated with that email, a verification code has been sent.';
const DUPLICATE_ID_MESSAGE = 'This ID is already registered. Please use a different ID.';
const DUPLICATE_EMAIL_MESSAGE = 'This email is already registered. Please use a different email address.';
const GENERIC_REGISTRATION_OTP_MESSAGE = 'If a pending registration is associated with that email, a verification code can be sent.';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FULL_NAME_PATTERN = /^[\p{L}\p{M}]+(?:[\s'’.-][\p{L}\p{M}]+)*$/u;
const DUMMY_FULL_NAME_VALUES = new Set([
  'test', 'user', 'admin', 'guest', 'student', 'coach', 'example', 'sample',
  'placeholder', 'dummy', 'demo', 'fake', 'null', 'undefined', 'n/a', 'na',
  'asdf', 'qwerty', 'lorem', 'ipsum', 'foo', 'bar'
]);
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'dispostable.com', 'temp-mail.org',
  '10minutemail.com', 'throwawaymail.com', 'yopmail.com', 'yomail.info',
  'trashmail.com', 'maildrop.cc'
]);
const DUMMY_EMAIL_PREFIXES = new Set([
  'test', 'dummy', 'demo', 'sample', 'placeholder', 'guest', 'fake', 'invalid',
  'noreply', 'no-reply', 'asdf', 'qwerty', 'lorem', 'ipsum'
]);
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isValidFullName = (value) => {
  const trimmedValue = String(value || '').trim();
  if (!trimmedValue || trimmedValue.length < 2) return false;
  if (!/[\p{L}]/u.test(trimmedValue)) return false;
  if (/\s{2,}/.test(trimmedValue) || /[\u0000-\u001F\u007F]/.test(trimmedValue)) return false;

  const sanitizedLetters = trimmedValue.replace(/[\s'’.-]/g, '');
  if (sanitizedLetters.length < 2) return false;
  if (/(.)\1{4,}/u.test(sanitizedLetters)) return false;

  const normalizedValue = trimmedValue.toLowerCase().replace(/[\s'’.-]+/g, ' ').trim();
  if (DUMMY_FULL_NAME_VALUES.has(normalizedValue)) return false;
  if (/^(?:test|user|guest|admin|student|coach|example|sample|dummy|demo|placeholder|fake|null|undefined|n\/a|na|asdf|qwerty|lorem|ipsum|foo|bar)$/i.test(normalizedValue)) {
    return false;
  }

  const lettersOnly = sanitizedLetters.replace(/[^\p{L}]/gu, '');
  const vowelCount = (lettersOnly.match(/[AEIOUaeiou]/g) || []).length;
  const consonantRatio = lettersOnly.length ? (lettersOnly.length - vowelCount) / lettersOnly.length : 0;
  if (lettersOnly.length >= 10 && consonantRatio >= 0.7 && !/\s/.test(trimmedValue)) {
    return false;
  }

  return FULL_NAME_PATTERN.test(trimmedValue);
};

const isDummyEmailAddress = (email) => {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail || !EMAIL_PATTERN.test(normalizedEmail)) {
    return false;
  }

  const [localPart, domain] = normalizedEmail.split('@');
  if (!localPart || !domain) return false;
  if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) return true;
  if (domain.includes('mailinator') || domain.includes('guerrillamail') || domain.includes('tempmail')) return true;

  const normalizedLocalPart = localPart.replace(/[._+-]+/g, '').toLowerCase();
  if (DUMMY_EMAIL_PREFIXES.has(normalizedLocalPart)) return true;
  if (normalizedLocalPart.startsWith('test') || normalizedLocalPart.startsWith('dummy') || normalizedLocalPart.startsWith('sample') || normalizedLocalPart.startsWith('placeholder')) {
    return true;
  }

  return false;
};

const respondWithPendingRegistration = (res, user) => {
  const now = Date.now();
  const lastSentAt = user.registrationOtpLastSentAt || user.otpLastSentAt || null;
  const otpHash = user.registrationOtpHash || user.otpHash || null;
  const otpExpiresAt = user.registrationOtpExpiresAt || user.otpExpiresAt || null;
  const retryAfterSeconds = lastSentAt
    ? Math.max(0, Math.ceil(
      (REGISTRATION_OTP_COOLDOWN_MS
        - (now - new Date(lastSentAt).getTime())) / 1000
    ))
    : 0;
  const emailSent = Boolean(
    otpHash
    && otpExpiresAt
    && new Date(otpExpiresAt).getTime() > now
  );

  return res.status(202).json({
    success: true,
    verificationRequired: true,
    emailSent,
    retryAfterSeconds,
    message: 'A registration for this email is awaiting verification. Enter your code or request a new one.'
  });
};

const buildRegistrationEmailFailureResponse = (error, message) => {
  const failure = getRegistrationEmailFailure(error);
  const failureCode = error?.code || error?.name || 'unknown';
  console.error(`Registration verification email delivery failed [${failureCode}]`);
  return {
    success: false,
    safeError: 'registration-email-delivery',
    verificationRequired: true,
    deliveryIssue: failure.code,
    message: message || failure.message
  };
};

const hashResetValue = (value) => crypto
  .createHmac('sha256', getJWTSecret())
  .update(String(value))
  .digest('hex');

const resetValueMatches = (value, expectedHash) => {
  const actual = Buffer.from(hashResetValue(value), 'hex');
  const expected = Buffer.from(String(expectedHash || ''), 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};

const clearPasswordResetState = (user) => {
  user.passwordResetOtpHash = null;
  user.passwordResetOtpExpiresAt = null;
  user.passwordResetOtpAttempts = 0;
  user.passwordResetLastSentAt = null;
  user.passwordResetTokenHash = null;
  user.passwordResetTokenExpiresAt = null;
  user.passwordResetTokenConsumedAt = null;
};

const issueLoginOtpForScreener = async (user) => {
  const otp = String(crypto.randomInt(100000, 1000000));
  const otpHash = hashResetValue(otp);
  const now = Date.now();

  user.registrationOtpHash = otpHash;
  user.registrationOtpExpiresAt = new Date(now + REGISTRATION_OTP_TTL_MS);
  user.registrationOtpAttempts = 0;
  user.registrationOtpLastSentAt = new Date(now);
  user.registrationOtpResendCount = 0;
  user.emailVerified = false;
  await user.save();

  try {
    await sendRegistrationVerificationOtp(user.email, otp, REGISTRATION_OTP_TTL_MS / 60000);
    return { success: true, email: user.email, message: 'A verification code was sent to your institutional email.' };
  } catch (error) {
    user.registrationOtpHash = null;
    user.registrationOtpExpiresAt = null;
    user.registrationOtpAttempts = 0;
    user.registrationOtpLastSentAt = null;
    user.registrationOtpResendCount = 0;
    await user.save();
    throw error;
  }
};

const isValidId = (id) => {
  const trimmedId = String(id || '').trim();
  if (!trimmedId || /\s/.test(trimmedId)) return false;

  if (/^\d{4}-\d{4}$/.test(trimmedId)) {
    return true;
  }

  return Boolean(
    trimmedId.length >= 7 &&
    /^[A-Za-z0-9!@#$%^&*(),.?":{}|<>_-]+$/.test(trimmedId)
  );
};

const buildUserResponse = (user, roleOverride) => {
  const resolvedRole = String(roleOverride || user?.role || 'student').trim().toLowerCase();

  if (resolvedRole === 'admin') {
    return {
      _id: user._id,
      fullname: user.fullname,
      email: user.email || '',
      notifications: user.notifications !== undefined ? user.notifications : true,
      role: resolvedRole,
      id: user.id
    };
  }

  return {
    _id: user._id,
    fullname: user.fullname,
    email: user.email || '',
    notifications: user.notifications !== undefined ? user.notifications : true,
    role: resolvedRole,
    id: user.id,
    dateOfBirth: user.dateOfBirth || user.dob || '',
    department: user.department || '',
    yearLevel: user.yearLevel || '',
    sport: user.sport || '',
    sports: Array.isArray(user.sports) && user.sports.length
      ? user.sports
      : (user.sport ? [user.sport] : []),
    branchCampus: user.branchCampus || ''
  };
};

exports.requestPasswordReset = async (req, res) => {
  try {
    const normalizedEmail = String(req.body?.email || '').trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address.'
      });
    }

    const user = await User.findOne({
      email: { $regex: `^${escapeRegex(normalizedEmail)}$`, $options: 'i' }
    }).select('+passwordResetLastSentAt');
    if (!user) return res.status(202).json({ success: true, message: GENERIC_RESET_MESSAGE });

    const now = Date.now();
    if (user.passwordResetLastSentAt && now - user.passwordResetLastSentAt.getTime() < RESET_OTP_COOLDOWN_MS) {
      return res.status(202).json({ success: true, message: GENERIC_RESET_MESSAGE });
    }

    const otp = String(crypto.randomInt(100000, 1000000));
    user.passwordResetOtpHash = hashResetValue(otp);
    user.passwordResetOtpExpiresAt = new Date(now + RESET_OTP_TTL_MS);
    user.passwordResetOtpAttempts = 0;
    user.passwordResetLastSentAt = new Date(now);
    user.passwordResetTokenHash = null;
    user.passwordResetTokenExpiresAt = null;
    user.passwordResetTokenConsumedAt = null;
    await user.save();

    try {
      await sendPasswordResetOtp(normalizedEmail, otp, RESET_OTP_TTL_MS / 60000);
    } catch (error) {
      clearPasswordResetState(user);
      await user.save();
      console.error('Password reset email delivery failed:', error.message);
      return res.status(503).json({
        success: false,
        message: 'The verification email could not be sent. Please try again later.'
      });
    }

    return res.status(202).json({ success: true, message: GENERIC_RESET_MESSAGE });
  } catch (error) {
    console.error('Password reset request failed:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Unable to process the password reset request. Please try again later.'
    });
  }
};

exports.verifyPasswordResetOtp = async (req, res) => {
  try {
    const normalizedEmail = String(req.body?.email || '').trim().toLowerCase();
    const otp = String(req.body?.otp || '').trim();
    if (!EMAIL_PATTERN.test(normalizedEmail) || !/^\d{6}$/.test(otp)) {
      return res.status(400).json({ success: false, message: 'Invalid or expired verification code.' });
    }

    const user = await User.findOne({
      email: { $regex: `^${escapeRegex(normalizedEmail)}$`, $options: 'i' }
    })
      .select('+passwordResetOtpHash +passwordResetOtpExpiresAt +passwordResetOtpAttempts');
    const now = Date.now();
    if (!user || !user.passwordResetOtpHash || !user.passwordResetOtpExpiresAt || user.passwordResetOtpExpiresAt.getTime() <= now) {
      return res.status(400).json({ success: false, message: 'Invalid or expired verification code.' });
    }

    if (user.passwordResetOtpAttempts >= RESET_OTP_MAX_ATTEMPTS) {
      clearPasswordResetState(user);
      await user.save();
      return res.status(429).json({ success: false, message: 'Too many verification attempts. Please request a new code.' });
    }

    user.passwordResetOtpAttempts += 1;
    if (!resetValueMatches(otp, user.passwordResetOtpHash)) {
      await user.save();
      return res.status(400).json({ success: false, message: 'Invalid or expired verification code.' });
    }

    const resetToken = crypto.randomBytes(32).toString('base64url');
    const resetTokenUpdate = await User.findOneAndUpdate(
      {
        _id: user._id,
        passwordResetOtpHash: user.passwordResetOtpHash,
        passwordResetOtpExpiresAt: { $gt: new Date(now) },
        passwordResetOtpAttempts: { $lt: RESET_OTP_MAX_ATTEMPTS },
      },
      {
        $set: {
          passwordResetOtpHash: null,
          passwordResetOtpExpiresAt: null,
          passwordResetOtpAttempts: 0,
          passwordResetTokenHash: hashResetValue(resetToken),
          passwordResetTokenExpiresAt: new Date(now + RESET_TOKEN_TTL_MS),
          passwordResetTokenConsumedAt: null,
        },
      },
      { new: true }
    );

    if (!resetTokenUpdate) {
      return res.status(400).json({ success: false, message: 'Invalid or expired verification code.' });
    }

    return res.json({ success: true, message: 'Verification successful.', resetToken });
  } catch (error) {
    console.error('Password reset verification failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to verify the code. Please try again later.' });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const normalizedEmail = String(req.body?.email || '').trim().toLowerCase();
    const resetToken = String(req.body?.resetToken || '').trim();
    const newPassword = String(req.body?.newPassword || '');
    if (!EMAIL_PATTERN.test(normalizedEmail) || !isPasswordValid(newPassword)) {
      return res.status(400).json({
        success: false,
        message: PASSWORD_POLICY_MESSAGE
      });
    }

    if (!resetToken) {
      return res.status(400).json({ success: false, message: 'Your verification has expired. Please request a new code.' });
    }

    const now = new Date();
    const passwordHash = await hashPassword(newPassword);
    const user = await User.findOneAndUpdate(
      {
        email: { $regex: `^${escapeRegex(normalizedEmail)}$`, $options: 'i' },
        passwordResetTokenHash: hashResetValue(resetToken),
        passwordResetTokenExpiresAt: { $gt: now },
        passwordResetTokenConsumedAt: null,
      },
      {
        $set: {
          password: passwordHash,
          passwordChangedAt: now,
          passwordResetTokenConsumedAt: now,
          passwordResetOtpHash: null,
          passwordResetOtpExpiresAt: null,
          passwordResetOtpAttempts: 0,
          passwordResetLastSentAt: null,
        },
      },
      { new: true, runValidators: true }
    );

    if (!user) {
      return res.status(400).json({ success: false, message: 'Your verification is invalid or expired. Please verify a new code.' });
    }

    await RefreshSession.updateMany(
      { userId: user._id, revokedAt: null },
      { $set: { revokedAt: now } }
    );
    return res.json({ success: true, message: 'Password reset successfully.' });
  } catch (error) {
    console.error('Password reset failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to reset your password. Please try again later.' });
  }
};

exports.verifyRegistrationOtp = async (req, res) => {
  try {
    const normalizedEmail = String(req.body?.email || '').trim().toLowerCase();
    const otp = String(req.body?.otp || '').trim();
    if (!EMAIL_PATTERN.test(normalizedEmail) || !/^\d{6}$/.test(otp)) {
      return res.status(400).json({ success: false, message: 'Enter a valid email and 6-digit verification code.' });
    }

    const pendingRegistration = await PendingRegistration.findOne({
      emailNormalized: normalizedEmail
    }).select('+registrationOtpHash +registrationOtpExpiresAt +registrationOtpAttempts');
    const now = Date.now();
    if (!pendingRegistration || !pendingRegistration.registrationOtpExpiresAt) {
      return res.status(400).json({ success: false, message: 'Invalid or expired verification code.' });
    }

    if (pendingRegistration.registrationOtpExpiresAt.getTime() <= now) {
      await PendingRegistration.deleteOne({ _id: pendingRegistration._id });
      return res.status(400).json({ success: false, message: 'This verification code has expired. Request a new code.' });
    }

    if (!pendingRegistration.registrationOtpHash) {
      return res.status(400).json({ success: false, message: 'Invalid or expired verification code.' });
    }

    if (pendingRegistration.registrationOtpAttempts >= REGISTRATION_OTP_MAX_ATTEMPTS) {
      await PendingRegistration.deleteOne({ _id: pendingRegistration._id });
      return res.status(429).json({ success: false, message: 'Too many verification attempts. Request a new code.' });
    }

    const otpHash = hashResetValue(otp);
    if (!resetValueMatches(otp, pendingRegistration.registrationOtpHash)) {
      const attemptUpdate = await PendingRegistration.findOneAndUpdate(
        {
          _id: pendingRegistration._id,
          registrationOtpHash: pendingRegistration.registrationOtpHash,
          registrationOtpExpiresAt: { $gt: new Date(now) },
          registrationOtpAttempts: { $lt: REGISTRATION_OTP_MAX_ATTEMPTS }
        },
        { $inc: { registrationOtpAttempts: 1 } },
        { new: true }
      );

      if (attemptUpdate?.registrationOtpAttempts >= REGISTRATION_OTP_MAX_ATTEMPTS) {
        await PendingRegistration.deleteOne({ _id: pendingRegistration._id });
        return res.status(429).json({ success: false, message: 'Too many verification attempts. Request a new code.' });
      }
      return res.status(400).json({ success: false, message: 'Invalid verification code. Please try again.' });
    }

    const existingUser = await User.findOne({
      $or: [
        { emailNormalized: normalizedEmail },
        { email: { $regex: `^${escapeRegex(normalizedEmail)}$`, $options: 'i' } },
        { id: pendingRegistration.id }
      ]
    });
    if (existingUser) {
      await PendingRegistration.deleteOne({ _id: pendingRegistration._id });
      return res.status(409).json({ success: false, message: DUPLICATE_EMAIL_MESSAGE });
    }

    const userPayload = {
      fullname: pendingRegistration.fullname,
      email: pendingRegistration.email,
      emailNormalized: pendingRegistration.emailNormalized,
      password: pendingRegistration.password,
      role: pendingRegistration.role || 'student',
      department: pendingRegistration.department || '',
      yearLevel: pendingRegistration.yearLevel || '',
      sport: pendingRegistration.sport || '',
      sports: Array.isArray(pendingRegistration.sports) ? pendingRegistration.sports : [],
      id: pendingRegistration.id,
      emailVerified: true,
      status: 'Active',
      accountStatus: 'active'
    };

    const createdUser = await User.create(userPayload);
    await PendingRegistration.deleteOne({ _id: pendingRegistration._id });

    if (createdUser) {
      console.log(`Registration verified and user created: ${createdUser.id} (${createdUser.role})`);
    }

    return res.json({ success: true, message: 'Email verified successfully.' });
  } catch (error) {
    console.error('Registration email verification failed:', error?.message || error);
    return res.status(500).json({ success: false, message: 'Unable to verify your email. Please try again later.' });
  }
};

exports.resendRegistrationOtp = async (req, res) => {
  try {
    const normalizedEmail = String(req.body?.email || '').trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      return res.status(400).json({ success: false, message: 'Please provide a valid email address.' });
    }

    const pendingRegistration = await PendingRegistration.findOne({
      emailNormalized: normalizedEmail
    }).select('+registrationOtpHash +registrationOtpExpiresAt +registrationOtpAttempts +registrationOtpLastSentAt +registrationOtpResendCount');

    if (!pendingRegistration) {
      return res.status(202).json({ success: true, message: GENERIC_REGISTRATION_OTP_MESSAGE });
    }

    const now = Date.now();
    const codeExpired = Boolean(
      pendingRegistration.registrationOtpExpiresAt
      && pendingRegistration.registrationOtpExpiresAt.getTime() <= now
    );
    if (pendingRegistration.registrationOtpLastSentAt) {
      const cooldownRemaining = REGISTRATION_OTP_COOLDOWN_MS
        - (now - pendingRegistration.registrationOtpLastSentAt.getTime());
      if (cooldownRemaining > 0) {
        const retryAfterSeconds = Math.ceil(cooldownRemaining / 1000);
        res.setHeader('Retry-After', String(retryAfterSeconds));
        return res.status(429).json({
          success: false,
          retryAfterSeconds,
          message: 'Please wait before requesting another verification code.'
        });
      }
    }

    const resendCount = codeExpired ? 0 : Number(pendingRegistration.registrationOtpResendCount || 0);
    if (resendCount >= REGISTRATION_OTP_MAX_RESENDS) {
      const retryAfterSeconds = Math.max(1, Math.ceil((pendingRegistration.registrationOtpExpiresAt.getTime() - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({
        success: false,
        retryAfterSeconds,
        message: 'Too many resend requests. Please wait for this code to expire before trying again.'
      });
    }

    const otp = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const otpHash = hashResetValue(otp);
    const expiresAt = new Date(now + REGISTRATION_OTP_TTL_MS);
    const expectedLastSentAt = pendingRegistration.registrationOtpLastSentAt || null;
    const expectedResendCount = Number(pendingRegistration.registrationOtpResendCount || 0);
    const updatedUser = await PendingRegistration.findOneAndUpdate(
      {
        _id: pendingRegistration._id,
        registrationOtpLastSentAt: expectedLastSentAt,
        registrationOtpResendCount: expectedResendCount
      },
      {
        $set: {
          registrationOtpHash: otpHash,
          registrationOtpExpiresAt: expiresAt,
          registrationOtpAttempts: 0,
          registrationOtpLastSentAt: new Date(now),
          registrationOtpResendCount: codeExpired ? 1 : expectedResendCount + 1,
          expiresAt: new Date(now + REGISTRATION_OTP_TTL_MS)
        }
      },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(429).json({
        success: false,
        retryAfterSeconds: Math.ceil(REGISTRATION_OTP_COOLDOWN_MS / 1000),
        message: 'Please wait before requesting another verification code.'
      });
    }

    try {
      await sendRegistrationVerificationOtp(normalizedEmail, otp, REGISTRATION_OTP_TTL_MS / 60000);
    } catch (error) {
      await PendingRegistration.updateOne(
        { _id: pendingRegistration._id, registrationOtpHash: otpHash },
        {
          $set: {
            registrationOtpHash: null,
            registrationOtpExpiresAt: null,
            registrationOtpLastSentAt: null,
            registrationOtpResendCount: 0,
            expiresAt: new Date(Date.now() + REGISTRATION_OTP_TTL_MS)
          }
        }
      );
      return res.status(503).json(buildRegistrationEmailFailureResponse(error));
    }

    return res.status(202).json({ success: true, message: GENERIC_REGISTRATION_OTP_MESSAGE });
  } catch (error) {
    console.error('Registration verification resend failed:', error?.message || error);
    return res.status(500).json({ success: false, message: 'Unable to resend the verification code. Please try again later.' });
  }
};

// Register Controller
exports.register = async (req, res) => {
  try {
    const { fullname, email, password, department, yearLevel, sport, sports, id } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();

    if (!fullname || !password || !id || !normalizedEmail) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields: fullname, email, password, and ID'
      });
    }

    const trimmedFullName = String(fullname).trim();
    if (!isValidFullName(trimmedFullName)) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid full name using letters and common name punctuation. Do not use placeholder or dummy names.'
      });
    }

    if (!EMAIL_PATTERN.test(normalizedEmail) || isDummyEmailAddress(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Please use a real email address that you regularly access.'
      });
    }

    if (!isPasswordValid(password)) {
      return res.status(400).json({ success: false, message: PASSWORD_POLICY_MESSAGE });
    }

    const trimmedId = id?.trim();
    if (!isValidId(trimmedId)) {
      return res.status(400).json({
        success: false,
        message: 'The ID number format is invalid. Coach IDs must use the format 0000-0000; student IDs must be at least 7 characters and use letters, numbers, or common special characters only.'
      });
    }

    const existingVerifiedUser = await User.findOne({
      $or: [
        { emailNormalized: normalizedEmail },
        { email: { $regex: `^${escapeRegex(normalizedEmail)}$`, $options: 'i' } },
        { id: trimmedId }
      ]
    });
    if (existingVerifiedUser) {
      return res.status(409).json({ success: false, message: existingVerifiedUser.id === trimmedId ? DUPLICATE_ID_MESSAGE : DUPLICATE_EMAIL_MESSAGE });
    }

    const pendingEmailUser = await PendingRegistration.findOne({
      emailNormalized: normalizedEmail
    }).select('+registrationOtpHash +registrationOtpExpiresAt +registrationOtpLastSentAt +registrationOtpResendCount');
    if (pendingEmailUser) {
      return respondWithPendingRegistration(res, pendingEmailUser);
    }

    const pendingIdUser = await PendingRegistration.findOne({ id: trimmedId }).select('+registrationOtpHash +registrationOtpExpiresAt +registrationOtpLastSentAt +registrationOtpResendCount');
    if (pendingIdUser) {
      return respondWithPendingRegistration(res, pendingIdUser);
    }

    const hashedPassword = await hashPassword(password);
    const now = Date.now();
    const otp = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const otpHash = hashResetValue(otp);
    const pendingPayload = {
      fullname: trimmedFullName,
      email: normalizedEmail,
      emailNormalized: normalizedEmail,
      emailVerified: false,
      registrationOtpHash: otpHash,
      registrationOtpExpiresAt: new Date(now + REGISTRATION_OTP_TTL_MS),
      registrationOtpAttempts: 0,
      registrationOtpLastSentAt: new Date(now),
      registrationOtpResendCount: 0,
      password: hashedPassword,
      role: /^\d{4}-\d{4}$/.test(trimmedId) ? 'coach' : 'student',
      id: trimmedId,
      department: department || '',
      expiresAt: new Date(now + REGISTRATION_OTP_TTL_MS)
    };

    const requestedSports = Array.isArray(sports)
      ? sports
      : (typeof sport === 'string' ? [sport] : []);
    const normalizedSports = [...new Set(requestedSports
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean))];
    if (normalizedSports.length > 34 || normalizedSports.some((value) => value.length > 100)) {
      return res.status(400).json({ success: false, message: 'Please select valid sports.' });
    }

    pendingPayload.sports = normalizedSports;
    pendingPayload.sport = normalizedSports[0] || '';
    if (pendingPayload.role === 'student') {
      const normalizedYearLevel = String(yearLevel || '').trim();
      if (normalizedYearLevel && !['I', 'II', 'III', 'IV'].includes(normalizedYearLevel)) {
        return res.status(400).json({ success: false, message: 'Please provide a valid year level.' });
      }
      pendingPayload.yearLevel = normalizedYearLevel;
    }

    const pendingRegistration = await PendingRegistration.create(pendingPayload);
    try {
      await sendRegistrationVerificationOtp(normalizedEmail, otp, REGISTRATION_OTP_TTL_MS / 60000);
    } catch (error) {
      await PendingRegistration.deleteOne({ _id: pendingRegistration._id });
      return res.status(503).json(buildRegistrationEmailFailureResponse(
        error,
        'Your registration is saved, but the verification email could not be sent. Use Resend Code to try again.'
      ));
    }

    console.log(`Pending registration awaiting email verification: ${pendingRegistration.id} (${pendingRegistration.role})`);
    return res.status(201).json({
      success: true,
      verificationRequired: true,
      emailSent: true,
      message: 'Registration accepted. Enter the verification code sent to your email.'
    });
  } catch (error) {
    console.error('Registration error:', error?.name || 'Unexpected error', error?.message || error);

    if (error.code === 11000) {
      const normalizedEmail = String(req.body?.email || '').trim().toLowerCase();
      const pendingRegistration = await PendingRegistration.findOne({
        $or: [
          { emailNormalized: normalizedEmail },
          { id: String(req.body?.id || '').trim() }
        ]
      }).select('+registrationOtpHash +registrationOtpExpiresAt +registrationOtpLastSentAt +registrationOtpResendCount');
      if (pendingRegistration) {
        return respondWithPendingRegistration(res, pendingRegistration);
      }
      return res.status(409).json({ success: false, message: 'This account information is already registered.' });
    }

    return res.status(500).json({
      success: false,
      message: 'Server error during registration. Please try again.'
    });
  }
};

// Login Controller - COMPLETE FIXED
exports.login = async (req, res) => {
  try {
    const id = req.body.id?.trim();
    const password = req.body.password;

    if (!id || !password) {
      return res.status(400).json({ 
        success: false,
        message: 'Please provide ID and password' 
      });
    }

    const user = await User.findOne({ id });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'No account found for this ID.'
      });
    }

    if (user.accountStatus === 'archived') {
      return res.status(403).json({
        success: false,
        message: 'This account has been archived.'
      });
    }

    const passwordCheck = await verifyPassword(password, user.password);

    if (!passwordCheck.valid) {
      return res.status(401).json({
        success: false,
        message: 'Incorrect password for this account.'
      });
    }

    const userRole = user.role?.toString().trim().toLowerCase();
    if (!['student', 'coach', 'admin', 'screener'].includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: 'This account is not authorized to log in.'
      });
    }

    if (passwordCheck.needsRehash) {
      user.password = await hashPassword(password);
    }

    if (userRole === 'screener' && user.emailVerified === false) {
      try {
        const otpResult = await issueLoginOtpForScreener(user);
        return res.status(202).json({
          success: true,
          verificationRequired: true,
          email: otpResult.email,
          user: buildUserResponse(user, userRole),
          message: otpResult.message
        });
      } catch (error) {
        console.error('Screener login verification email delivery failed.', error?.message || error);
        return res.status(503).json({
          success: false,
          message: 'Your account is ready, but the verification email could not be sent. Please try again later.'
        });
      }
    }

    // Accounts predating email verification have no flag and remain compatible.
    if (user.emailVerified === false) {
      return res.status(403).json({
        success: false,
        message: 'Please verify your email before logging in. Return to the Registration Page to enter or resend your verification code.'
      });
    }

    user.lastActiveAt = new Date();
    user.status = 'Active';
    if (typeof user.save === 'function') {
      await user.save();
    }

    const accessToken = createAccessToken({
      _id: user._id,
      role: userRole,
      email: user.email || ''
    });
    const { refreshToken } = await createRefreshSession(user._id);
    const csrfToken = crypto.randomBytes(32).toString('base64url');
    setAuthenticationCookies(res, accessToken, refreshToken, csrfToken, userRole);

    res.json({
      success: true,
      message: `Welcome back, ${user.fullname}!`,
      user: buildUserResponse(user, userRole)
    });

  } catch (error) {
    console.error('❌ Login error:', error);

    res.status(500).json({
      success: false,
      message: 'Server error during login. Please try again.'
    });
  }
};

exports.verifyLoginOtp = async (req, res) => {
  try {
    const id = String(req.body?.id || '').trim();
    const otp = String(req.body?.otp || '').trim();

    if (!id || !/^\d{6}$/.test(otp)) {
      return res.status(400).json({ success: false, message: 'Enter a valid 6-digit verification code.' });
    }

    const user = await User.findOne({ id, role: 'screener' }).select('+registrationOtpHash +registrationOtpExpiresAt +registrationOtpAttempts');
    if (!user) {
      return res.status(401).json({ success: false, message: 'No matching Screener account was found.' });
    }

    const now = Date.now();
    if (!user.registrationOtpHash || !user.registrationOtpExpiresAt) {
      return res.status(400).json({ success: false, message: 'No active verification code is available. Please log in again.' });
    }
    if (user.registrationOtpExpiresAt.getTime() <= now) {
      await User.updateOne(
        { _id: user._id, registrationOtpHash: user.registrationOtpHash },
        { $set: { registrationOtpHash: null, registrationOtpExpiresAt: null, registrationOtpAttempts: 0 } }
      );
      return res.status(400).json({ success: false, message: 'This verification code has expired. Please request a new code.' });
    }
    if (user.registrationOtpAttempts >= REGISTRATION_OTP_MAX_ATTEMPTS) {
      await User.updateOne(
        { _id: user._id, registrationOtpHash: user.registrationOtpHash },
        { $set: { registrationOtpHash: null, registrationOtpExpiresAt: null, registrationOtpAttempts: 0 } }
      );
      return res.status(429).json({ success: false, message: 'Too many attempts. Please request a new code.' });
    }

    if (!resetValueMatches(otp, user.registrationOtpHash)) {
      const attemptUpdate = await User.findOneAndUpdate(
        {
          _id: user._id,
          role: 'screener',
          registrationOtpHash: user.registrationOtpHash,
          registrationOtpExpiresAt: { $gt: new Date(now) },
          registrationOtpAttempts: { $lt: REGISTRATION_OTP_MAX_ATTEMPTS }
        },
        { $inc: { registrationOtpAttempts: 1 } },
        { new: true }
      );
      if (attemptUpdate?.registrationOtpAttempts >= REGISTRATION_OTP_MAX_ATTEMPTS) {
        await User.updateOne(
          { _id: user._id, registrationOtpHash: user.registrationOtpHash },
          { $set: { registrationOtpHash: null, registrationOtpExpiresAt: null, registrationOtpAttempts: 0 } }
        );
        return res.status(429).json({ success: false, message: 'Too many attempts. Please request a new code.' });
      }
      return res.status(400).json({ success: false, message: 'The code you entered is invalid. Please try again.' });
    }

    const verifiedUser = await User.findOneAndUpdate(
      {
        _id: user._id,
        role: 'screener',
        registrationOtpHash: user.registrationOtpHash,
        registrationOtpExpiresAt: { $gt: new Date(now) },
        emailVerified: false
      },
      {
        $set: { emailVerified: true },
        $unset: {
          registrationOtpHash: 1,
          registrationOtpExpiresAt: 1,
          registrationOtpAttempts: 1,
          registrationOtpLastSentAt: 1,
          registrationOtpResendCount: 1
        }
      },
      { new: true }
    );

    if (!verifiedUser) {
      return res.status(400).json({ success: false, message: 'This verification code is no longer valid.' });
    }

    const accessToken = createAccessToken({
      _id: verifiedUser._id,
      role: 'screener',
      email: verifiedUser.email || ''
    });
    const { refreshToken } = await createRefreshSession(verifiedUser._id);
    const csrfToken = crypto.randomBytes(32).toString('base64url');
    setAuthenticationCookies(res, accessToken, refreshToken, csrfToken, 'screener');

    return res.json({
      success: true,
      message: 'Verification successful. Redirecting to your Screener portal.',
      user: buildUserResponse(verifiedUser, 'screener')
    });
  } catch (error) {
    console.error('Screener login verification failed.', error);
    return res.status(500).json({ success: false, message: 'Unable to verify your code. Please try again later.' });
  }
};

exports.resendLoginOtp = async (req, res) => {
  try {
    const id = String(req.body?.id || '').trim();
    if (!id) {
      return res.status(400).json({ success: false, message: 'A Screener ID is required.' });
    }

    const user = await User.findOne({ id, role: 'screener' }).select('+registrationOtpHash +registrationOtpExpiresAt +registrationOtpLastSentAt +registrationOtpResendCount');
    if (!user) {
      return res.status(404).json({ success: false, message: 'No matching Screener account was found.' });
    }

    const now = Date.now();
    if (user.registrationOtpLastSentAt && now - user.registrationOtpLastSentAt.getTime() < REGISTRATION_OTP_COOLDOWN_MS) {
      return res.status(429).json({
        success: false,
        retryAfterSeconds: Math.ceil((REGISTRATION_OTP_COOLDOWN_MS - (now - user.registrationOtpLastSentAt.getTime())) / 1000),
        message: 'Please wait a moment before requesting a new code.'
      });
    }

    const otp = String(crypto.randomInt(100000, 1000000));
    const otpHash = hashResetValue(otp);
    user.registrationOtpHash = otpHash;
    user.registrationOtpExpiresAt = new Date(now + REGISTRATION_OTP_TTL_MS);
    user.registrationOtpAttempts = 0;
    user.registrationOtpLastSentAt = new Date(now);
    user.registrationOtpResendCount = Number(user.registrationOtpResendCount || 0) + 1;
    user.emailVerified = false;
    await user.save();

    try {
      await sendRegistrationVerificationOtp(user.email, otp, REGISTRATION_OTP_TTL_MS / 60000);
      return res.status(202).json({ success: true, message: 'A new verification code has been sent to your institutional email.' });
    } catch (error) {
      user.registrationOtpHash = null;
      user.registrationOtpExpiresAt = null;
      user.registrationOtpAttempts = 0;
      user.registrationOtpLastSentAt = null;
      user.registrationOtpResendCount = 0;
      await user.save();
      console.error('Screener login verification resend failed.', error?.message || error);
      return res.status(503).json({ success: false, message: 'The verification email could not be sent. Please try again later.' });
    }
  } catch (error) {
    console.error('Screener login OTP resend failed.', error);
    return res.status(500).json({ success: false, message: 'Unable to resend your verification code. Please try again later.' });
  }
};

exports.refreshSession = async (req, res) => {
  try {
    const refreshCookie = getAuthCookie(req, REFRESH_COOKIE_NAME);
    const rawRefreshToken = refreshCookie.value;
    if (!rawRefreshToken) return res.status(401).json({ success: false, message: 'Not authorized' });

    const tokenHash = hashRefreshToken(rawRefreshToken);
    const requestedRole = getPortalRole(req);
    if (requestedRole && refreshCookie.name === REFRESH_COOKIE_NAME) {
      const legacySession = await RefreshSession.findOne({
        tokenHash,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      }).select('userId').lean();
      if (!legacySession) return res.status(401).json({ success: false, message: 'Not authorized' });

      const legacyUser = await User.findById(legacySession.userId).select('role accountStatus').lean();
      if (!legacyUser || legacyUser.accountStatus === 'archived'
        || normalizePortalRole(legacyUser.role) !== requestedRole) {
        return res.status(401).json({ success: false, message: 'Not authorized' });
      }
    }

    const session = await RefreshSession.findOneAndUpdate(
      {
        tokenHash,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      },
      { $set: { revokedAt: new Date() } },
      { new: true }
    ).select('+tokenHash');

    if (!session) return res.status(401).json({ success: false, message: 'Not authorized' });

    const user = await User.findById(session.userId).select('-password +passwordChangedAt');
    if (!user || user.accountStatus === 'archived') {
      await RefreshSession.updateMany({ userId: session.userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
      return res.status(401).json({ success: false, message: 'Not authorized' });
    }

    if (user.emailVerified === false) {
      await RefreshSession.updateMany(
        { userId: session.userId, revokedAt: null },
        { $set: { revokedAt: new Date() } }
      );
      clearAuthenticationCookies(res, getPortalRole(req));
      return res.status(403).json({
        success: false,
        message: 'Email verification is required before accessing this account.'
      });
    }

    const portalRole = getPortalRole(req);
    if (portalRole && normalizePortalRole(user.role) !== portalRole) {
      return res.status(401).json({ success: false, message: 'Not authorized' });
    }

    if (user.passwordChangedAt && session.createdAt
      && new Date(session.createdAt).getTime() <= new Date(user.passwordChangedAt).getTime()) {
      await RefreshSession.updateMany(
        { userId: session.userId, familyId: session.familyId, revokedAt: null },
        { $set: { revokedAt: new Date() } }
      );
      return res.status(401).json({ success: false, message: 'Not authorized' });
    }

    const nextSession = await createRefreshSession(user._id, session.familyId);
    session.replacedByTokenHash = nextSession.tokenHash;
    await session.save();

    const latestUser = await User.findById(session.userId).select('-password +passwordChangedAt');
    const latestPasswordChangedAt = latestUser?.passwordChangedAt
      ? new Date(latestUser.passwordChangedAt).getTime()
      : 0;
    if (!latestUser || (latestPasswordChangedAt && session.createdAt
      && new Date(session.createdAt).getTime() <= latestPasswordChangedAt)) {
      await RefreshSession.updateOne(
        { tokenHash: nextSession.tokenHash, revokedAt: null },
        { $set: { revokedAt: new Date() } }
      );
      return res.status(401).json({ success: false, message: 'Not authorized' });
    }

    setAuthenticationCookies(
      res,
      createAccessToken(user),
      nextSession.refreshToken,
      crypto.randomBytes(32).toString('base64url'),
      normalizePortalRole(user.role)
    );
    return res.json({ success: true });
  } catch (error) {
    console.error('Refresh session persistence failed');
    return res.status(500).json({
      success: false,
      message: 'Unable to refresh session. Please try again later.'
    });
  }
};

exports.logout = async (req, res) => {
  try {
    const rawRefreshToken = getAuthCookie(req, REFRESH_COOKIE_NAME).value;
    if (rawRefreshToken) {
      await RefreshSession.updateOne(
        { tokenHash: hashRefreshToken(rawRefreshToken), revokedAt: null },
        { $set: { revokedAt: new Date() } }
      );
    }
    clearAuthenticationCookies(res, getPortalRole(req));
    return res.json({ success: true });
  } catch (error) {
    console.error('Logout session revocation failed');
    clearAuthenticationCookies(res, getPortalRole(req));
    return res.status(500).json({
      success: false,
      message: 'Unable to log out. Please try again later.'
    });
  }
};