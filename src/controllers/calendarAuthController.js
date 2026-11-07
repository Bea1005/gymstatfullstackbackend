const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const PendingRegistration = require('../models/PendingRegistration');
const User = require('../models/User');
const { hashPassword, verifyPassword, isPasswordValid, PASSWORD_POLICY_MESSAGE } = require('../config/passwords');
const { getJWTSecret } = require('../config/security');
const { normalizePhoneNumber } = require('../config/sms');
const { getRegistrationEmailFailure, sendRegistrationVerificationOtp } = require('../config/email');
const { getScheduleAccountType } = require('../utils/scheduleClientType');
const {
  createAccessToken,
  createRefreshSession,
  setAuthenticationCookies,
} = require('../config/authTokens');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_PART_PATTERN = /^[\p{L}\p{M}]+(?:[\s'’.-][\p{L}\p{M}]+)*$/u;
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_RESENDS = 5;
const googleClient = new OAuth2Client();

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const accountTypeForEmail = (email) => getScheduleAccountType(email);
const hashOtp = (otp) => crypto.createHmac('sha256', getJWTSecret()).update(String(otp)).digest('hex');
const matchesOtp = (otp, expectedHash) => {
  const actual = Buffer.from(hashOtp(otp), 'hex');
  const expected = Buffer.from(String(expectedHash || ''), 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};
const isNamePart = (value) => {
  const name = String(value || '').trim();
  return name.length >= 1 && name.length <= 60 && NAME_PART_PATTERN.test(name);
};
const userResponse = (user, accountType = accountTypeForEmail(normalizeEmail(user.email))) => ({
  _id: user._id,
  id: user.id,
  fullname: user.fullname || '',
  email: user.email,
  contactNumber: user.contactNumber || '',
  role: String(user.role || 'calendar').toLowerCase(),
  accountType,
  emailVerified: user.emailVerified === true,
});
const profileIsComplete = (user) => Boolean(
  String(user.fullname || '').trim()
  && normalizePhoneNumber(user.contactNumber)
);

const issueSession = async (res, user) => {
  const role = String(user.role || 'calendar').trim().toLowerCase();
  const accessToken = createAccessToken({ _id: user._id, role, email: user.email || '' });
  const { refreshToken } = await createRefreshSession(user._id);
  setAuthenticationCookies(
    res,
    accessToken,
    refreshToken,
    crypto.randomBytes(32).toString('base64url'),
    role
  );
  return userResponse(user);
};

const findUserByEmail = (email) => User.findOne({
  $or: [
    { emailNormalized: email },
    { email: { $regex: `^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } },
  ],
});

const createVerifiedCalendarUser = async (pending) => {
  await User.ensureEmailIndex();
  const existingUser = await findUserByEmail(pending.emailNormalized);
  if (existingUser) {
    await PendingRegistration.deleteOne({ _id: pending._id });
    const error = new Error('This email is already registered. Please log in instead.');
    error.statusCode = 409;
    throw error;
  }

  const user = await User.create({
    fullname: pending.fullname,
    email: pending.emailNormalized,
    emailNormalized: pending.emailNormalized,
    emailVerified: true,
    verificationMethod: 'email',
    accountType: accountTypeForEmail(pending.emailNormalized),
    contactNumber: pending.contactNumber,
    contactNumberVerified: false,
    password: pending.password,
    role: 'calendar',
    id: pending.id,
    status: 'Active',
    accountStatus: 'active',
  });
  await PendingRegistration.deleteOne({ _id: pending._id });
  return user;
};

exports.register = async (req, res) => {
  try {
    const firstName = String(req.body?.firstName || '').trim();
    const middleName = String(req.body?.middleName || '').trim();
    const lastName = String(req.body?.lastName || '').trim();
    const email = normalizeEmail(req.body?.email);
    const rawPhone = String(req.body?.phoneNumber || '').trim();
    const phoneNumber = normalizePhoneNumber(rawPhone);
    const password = String(req.body?.password || '');

    if (!isNamePart(firstName) || (middleName && !isNamePart(middleName)) || !isNamePart(lastName)) {
      return res.status(400).json({ success: false, message: 'Enter valid first and last names. Middle name is optional.' });
    }
    if (!EMAIL_PATTERN.test(email)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
    }
    if (!phoneNumber) {
      return res.status(400).json({ success: false, message: 'Use a Philippine mobile number in the format 09XXXXXXXXX or +639XXXXXXXXX.' });
    }
    if (!isPasswordValid(password)) {
      return res.status(400).json({ success: false, message: PASSWORD_POLICY_MESSAGE });
    }
    await User.ensureEmailIndex();
    if (await User.hasRegisteredEmail(email)) {
      return res.status(409).json({ success: false, message: 'This email is already registered. Please log in instead.' });
    }

    const existingPending = await PendingRegistration.findOne({ emailNormalized: email });
    if (existingPending) {
      if (existingPending.role !== 'calendar') {
        return res.status(409).json({ success: false, message: 'This email already has a registration in progress.' });
      }
      return res.status(409).json({
        success: false,
        message: 'A registration is already awaiting verification. Use Resend verification from the email verification screen.',
      });
    }

    const fullname = [firstName, middleName, lastName].filter(Boolean).join(' ');
    const otp = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);
    const pending = await PendingRegistration.create({
      fullname,
      email,
      emailNormalized: email,
      contactNumber: phoneNumber,
      verificationMethod: 'email',
      password: await hashPassword(password),
      role: 'calendar',
      id: `calendar-${crypto.randomBytes(16).toString('hex')}`,
      registrationOtpHash: hashOtp(otp),
      registrationOtpExpiresAt: expiresAt,
      registrationOtpAttempts: 0,
      registrationOtpLastSentAt: new Date(),
      registrationOtpResendCount: 0,
      emailVerified: false,
      expiresAt,
    });

    try {
      await sendRegistrationVerificationOtp(email, otp, OTP_TTL_MS / 60000);
    } catch (error) {
      await PendingRegistration.deleteOne({ _id: pending._id });
      console.error('Public Calendar verification email delivery failed:', error?.code || error?.name || 'unknown');
      const deliveryFailure = getRegistrationEmailFailure(error);
      return res.status(503).json({
        success: false,
        message: deliveryFailure.message,
      });
    }

    return res.status(202).json({
      success: true,
      verificationRequired: true,
      message: 'Check your email for a verification code. Your account will be created after verification.',
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: 'This email is already registered or has a registration in progress.' });
    }
    console.error('Public Calendar registration failed:', error?.message || error);
    return res.status(500).json({ success: false, message: 'Unable to start registration. Please try again later.' });
  }
};

exports.verifyRegistration = async (req, res) => {
  let pendingId;
  try {
    const email = normalizeEmail(req.body?.email);
    const otp = String(req.body?.otp || '').trim();
    if (!EMAIL_PATTERN.test(email) || !/^\d{6}$/.test(otp)) {
      return res.status(400).json({ success: false, message: 'Enter the valid 6-digit code sent to your email.' });
    }

    let pending = await PendingRegistration.findOne({ emailNormalized: email })
      .select('+registrationOtpHash +registrationOtpExpiresAt +registrationOtpAttempts');
    pendingId = pending?._id;
    if (!pending || pending.role !== 'calendar' || new Date(pending.expiresAt).getTime() <= Date.now()) {
      if (pending && new Date(pending.expiresAt).getTime() <= Date.now()) {
        await PendingRegistration.deleteOne({ _id: pending._id });
      }
      return res.status(400).json({ success: false, message: 'This registration code is invalid or expired. Please register again.' });
    }
    if (pending.emailVerified) {
      await PendingRegistration.deleteOne({ _id: pending._id });
      return res.status(400).json({ success: false, message: 'This verification attempt has already been used. Please register again.' });
    }

    if (!pending.registrationOtpHash
      || !pending.registrationOtpExpiresAt
      || new Date(pending.registrationOtpExpiresAt).getTime() <= Date.now()) {
      return res.status(400).json({ success: false, message: 'This verification code has expired. Request a new code.' });
    }
    if (pending.registrationOtpAttempts >= OTP_MAX_ATTEMPTS) {
      await PendingRegistration.deleteOne({ _id: pending._id });
      return res.status(429).json({ success: false, message: 'Too many verification attempts. Please register again.' });
    }
    if (!matchesOtp(otp, pending.registrationOtpHash)) {
      const updated = await PendingRegistration.findOneAndUpdate(
        { _id: pending._id, registrationOtpHash: pending.registrationOtpHash },
        { $inc: { registrationOtpAttempts: 1 } },
        { new: true }
      );
      if (updated?.registrationOtpAttempts >= OTP_MAX_ATTEMPTS) {
        await PendingRegistration.deleteOne({ _id: pending._id });
        return res.status(429).json({ success: false, message: 'Too many verification attempts. Please register again.' });
      }
      return res.status(400).json({ success: false, message: 'The verification code is incorrect.' });
    }

    pending = await PendingRegistration.findOneAndUpdate(
      {
        _id: pending._id,
        role: 'calendar',
        registrationOtpHash: pending.registrationOtpHash,
        registrationOtpExpiresAt: { $gt: new Date() },
        registrationOtpAttempts: { $lt: OTP_MAX_ATTEMPTS },
        emailVerified: false,
      },
      {
        $set: {
          emailVerified: true,
          registrationOtpHash: null,
          registrationOtpExpiresAt: null,
          registrationOtpAttempts: 0,
        },
      },
      { new: true }
    );
    if (!pending) {
      return res.status(400).json({ success: false, message: 'This verification code is no longer valid. Request a new code.' });
    }

    const user = await createVerifiedCalendarUser(pending);
    const responseUser = await issueSession(res, user);
    return res.json({
      success: true,
      message: 'Email verified. Your account is ready.',
      user: responseUser,
      needsProfileCompletion: !profileIsComplete(user),
    });
  } catch (error) {
    if (pendingId) {
      try {
        await PendingRegistration.deleteOne({ _id: pendingId });
      } catch (cleanupError) {
        console.error('Unable to remove a completed Public Calendar verification attempt:', cleanupError?.message || cleanupError);
      }
    }
    if (error?.statusCode === 409) {
      return res.status(409).json({ success: false, message: error.message });
    }
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: 'This email is already registered. Please log in instead.' });
    }
    console.error('Public Calendar email verification failed:', error?.message || error);
    return res.status(500).json({ success: false, message: 'Unable to complete verification. Please try again.' });
  }
};

exports.resendVerification = async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!EMAIL_PATTERN.test(email)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
    }

    const pending = await PendingRegistration.findOne({ emailNormalized: email, role: 'calendar' })
      .select('+registrationOtpHash +registrationOtpLastSentAt +registrationOtpResendCount');
    if (!pending || new Date(pending.expiresAt).getTime() <= Date.now()) {
      return res.status(400).json({ success: false, message: 'This registration has expired. Please register again.' });
    }
    if (pending.emailVerified) {
      return res.status(409).json({ success: false, message: 'This email is already verified. Complete verification to continue.' });
    }

    const elapsed = pending.registrationOtpLastSentAt
      ? Date.now() - new Date(pending.registrationOtpLastSentAt).getTime()
      : OTP_COOLDOWN_MS;
    if (elapsed < OTP_COOLDOWN_MS) {
      const retryAfterSeconds = Math.ceil((OTP_COOLDOWN_MS - elapsed) / 1000);
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({
        success: false,
        retryAfterSeconds,
        message: 'Please wait before requesting another verification code.',
      });
    }
    if (pending.registrationOtpResendCount >= OTP_MAX_RESENDS) {
      return res.status(429).json({ success: false, message: 'You have reached the resend limit. Please register again later.' });
    }

    const otp = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const now = new Date();
    const updatedPending = await PendingRegistration.findOneAndUpdate(
      { _id: pending._id, registrationOtpLastSentAt: pending.registrationOtpLastSentAt },
      {
        $set: {
          registrationOtpHash: hashOtp(otp),
          registrationOtpExpiresAt: new Date(now.getTime() + OTP_TTL_MS),
          registrationOtpAttempts: 0,
          registrationOtpLastSentAt: now,
          expiresAt: new Date(now.getTime() + OTP_TTL_MS),
        },
        $inc: { registrationOtpResendCount: 1 },
      },
      { new: true }
    );
    if (!updatedPending) {
      return res.status(409).json({ success: false, message: 'Verification details changed. Please try again.' });
    }

    try {
      await sendRegistrationVerificationOtp(email, otp, OTP_TTL_MS / 60000);
    } catch (error) {
      await PendingRegistration.findOneAndUpdate(
        { _id: updatedPending._id, registrationOtpHash: hashOtp(otp) },
        { $set: { registrationOtpHash: null, registrationOtpExpiresAt: null } }
      );
      console.error('Public Calendar verification resend failed:', error?.code || error?.name || 'unknown');
      const deliveryFailure = getRegistrationEmailFailure(error);
      return res.status(503).json({ success: false, message: deliveryFailure.message });
    }
    return res.json({ success: true, retryAfterSeconds: OTP_COOLDOWN_MS / 1000, message: 'A new verification code was sent.' });
  } catch (error) {
    console.error('Public Calendar verification resend failed:', error?.message || error);
    return res.status(500).json({ success: false, message: 'Unable to resend the verification code.' });
  }
};

exports.login = async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    if (!EMAIL_PATTERN.test(email) || !password) {
      return res.status(400).json({ success: false, message: 'Enter a valid email and password.' });
    }

    const user = await findUserByEmail(email);
    if (!user || user.accountStatus === 'archived') {
      return res.status(401).json({ success: false, message: 'The email or password is incorrect.' });
    }
    if (user.emailVerified === false && user.contactNumberVerified !== true) {
      return res.status(403).json({ success: false, message: 'Verify your email before requesting a schedule.' });
    }
    const passwordResult = await verifyPassword(password, user.password);
    if (!passwordResult.valid) {
      return res.status(401).json({ success: false, message: 'The email or password is incorrect.' });
    }
    if (passwordResult.needsRehash) user.password = await hashPassword(password);
    user.accountType = accountTypeForEmail(email);
    user.lastActiveAt = new Date();
    user.status = 'Active';
    await user.save();

    const responseUser = await issueSession(res, user);
    return res.json({
      success: true,
      user: responseUser,
      needsProfileCompletion: !profileIsComplete(user),
    });
  } catch (error) {
    console.error('Public Calendar login failed:', error?.message || error);
    return res.status(500).json({ success: false, message: 'Unable to sign in. Please try again later.' });
  }
};

exports.googleLogin = async (req, res) => {
  try {
    const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
    const credential = String(req.body?.credential || '').trim();
    if (!clientId) {
      return res.status(503).json({ success: false, message: 'Google sign-in is not configured on the server.' });
    }
    if (!credential) {
      return res.status(400).json({ success: false, message: 'Google did not return an identity credential.' });
    }

    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: clientId });
    const identity = ticket.getPayload();
    const email = normalizeEmail(identity?.email);
    const googleSub = String(identity?.sub || '').trim();
    if (!identity || identity.email_verified !== true || !EMAIL_PATTERN.test(email) || !googleSub) {
      return res.status(401).json({ success: false, message: 'Google could not verify this email address.' });
    }

    await User.ensureEmailIndex();
    await User.ensureGoogleIndex();
    let user = await User.findOne({ googleSub }).select('+googleSub');
    if (!user) user = await findUserByEmail(email).select('+googleSub');
    if (user?.accountStatus === 'archived') {
      return res.status(403).json({ success: false, message: 'This account has been archived.' });
    }
    if (user?.googleSub && user.googleSub !== googleSub) {
      return res.status(409).json({ success: false, message: 'This email is linked to a different Google account.' });
    }
    if (user && normalizeEmail(user.email) !== email) {
      const emailOwner = await findUserByEmail(email);
      if (emailOwner && String(emailOwner._id) !== String(user._id)) {
        return res.status(409).json({ success: false, message: 'This verified Google email is already linked to another account.' });
      }
      user.email = email;
      user.emailNormalized = email;
    }
    if (!user) {
      const fullname = String(identity.name || [identity.given_name, identity.family_name].filter(Boolean).join(' ') || email.split('@')[0]).trim();
      user = await User.create({
        fullname,
        email,
        emailNormalized: email,
        emailVerified: true,
        verificationMethod: 'email',
        accountType: accountTypeForEmail(email),
        contactNumber: '',
        password: await hashPassword(crypto.randomBytes(48).toString('base64url')),
        role: 'calendar',
        id: `calendar-${crypto.randomBytes(16).toString('hex')}`,
        googleSub,
        status: 'Active',
        accountStatus: 'active',
      });
    } else {
      user.googleSub = googleSub;
      user.emailVerified = true;
      user.accountType = accountTypeForEmail(email);
      user.lastActiveAt = new Date();
      user.status = 'Active';
      await user.save();
    }

    const responseUser = await issueSession(res, user);
    return res.json({
      success: true,
      user: responseUser,
      needsProfileCompletion: !profileIsComplete(user),
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: 'This email is already registered. Please log in with your existing account.' });
    }
    console.error('Public Calendar Google authentication failed:', error?.message || error);
    return res.status(401).json({ success: false, message: 'Google sign-in failed. Please try again.' });
  }
};

exports.getSession = async (req, res) => {
  try {
    if (!req.user || req.user.emailVerified === false) {
      return res.status(401).json({ success: false, message: 'No verified calendar session is active.' });
    }
    const user = await User.findById(req.user._id).select('-password');
    if (!user || user.accountStatus === 'archived') {
      return res.status(401).json({ success: false, message: 'No active calendar session is available.' });
    }
    user.accountType = accountTypeForEmail(normalizeEmail(user.email));
    return res.json({
      success: true,
      user: userResponse(user),
      needsProfileCompletion: !profileIsComplete(user),
    });
  } catch (error) {
    console.error('Public Calendar session lookup failed:', error?.message || error);
    return res.status(500).json({ success: false, message: 'Unable to verify your calendar session.' });
  }
};

exports.completeProfile = async (req, res) => {
  try {
    const fullname = String(req.body?.fullname || '').trim();
    const phoneNumber = normalizePhoneNumber(req.body?.phoneNumber);
    if (!fullname || fullname.length > 180 || !NAME_PART_PATTERN.test(fullname)) {
      return res.status(400).json({ success: false, message: 'Enter a valid first and last name.' });
    }
    if (!phoneNumber) {
      return res.status(400).json({ success: false, message: 'Use a Philippine mobile number in the format 09XXXXXXXXX or +639XXXXXXXXX.' });
    }
    const user = await User.findById(req.user._id);
    if (!user || user.accountStatus === 'archived' || user.emailVerified === false) {
      return res.status(403).json({ success: false, message: 'An active, verified session is required.' });
    }
    user.fullname = fullname;
    user.contactNumber = phoneNumber;
    user.accountType = accountTypeForEmail(normalizeEmail(user.email));
    await user.save();
    return res.json({ success: true, user: userResponse(user), needsProfileCompletion: false });
  } catch (error) {
    console.error('Public Calendar profile completion failed:', error?.message || error);
    return res.status(500).json({ success: false, message: 'Unable to save your account details. Please try again.' });
  }
};
