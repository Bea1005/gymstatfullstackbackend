const User = require('../models/User');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { getJWTSecret } = require('../config/security');
const { hashPassword, verifyPassword } = require('../config/passwords');
const { sendPasswordResetOtp } = require('../config/email');

const RESET_OTP_TTL_MS = 10 * 60 * 1000;
const RESET_OTP_COOLDOWN_MS = 60 * 1000;
const RESET_OTP_MAX_ATTEMPTS = 5;
const RESET_VERIFICATION_TTL_MS = 10 * 60 * 1000;
const GENERIC_RESET_MESSAGE = 'If an account is associated with that email, a verification code has been sent.';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_PATTERN = /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>_\-]).{8,}$/;

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
  user.passwordResetVerifiedAt = null;
};

const detectRoleFromId = (id) => {
  const trimmedId = String(id || '').trim();

  if (!trimmedId || trimmedId.length < 7 || /\s/.test(trimmedId) || !/^[A-Za-z0-9!@#$%^&*(),.?":{}|<>_-]+$/.test(trimmedId)) {
    return null;
  }

  if (trimmedId.toLowerCase().startsWith('screener') || trimmedId.toLowerCase().startsWith('sc')) {
    return 'screener';
  }
  
  if (trimmedId.toLowerCase().startsWith('admin')) {
    return 'admin';
  }

  if (/^[A-Za-z0-9]{7}$/.test(trimmedId)) {
    return 'student';
  }

  return 'coach';
};

const isValidId = (id) => {
  return Boolean(detectRoleFromId(id));
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

    const user = await User.findOne({ email: normalizedEmail }).select('+passwordResetLastSentAt');
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
    user.passwordResetVerifiedAt = null;
    await user.save();

    try {
      await sendPasswordResetOtp(normalizedEmail, otp, RESET_OTP_TTL_MS / 60000);
    } catch (error) {
      clearPasswordResetState(user);
      await user.save();
      console.error('Password reset email delivery failed:', error.message);
      return res.status(202).json({ success: true, message: GENERIC_RESET_MESSAGE });
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

    const user = await User.findOne({ email: normalizedEmail })
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

    user.passwordResetOtpHash = null;
    user.passwordResetOtpExpiresAt = null;
    user.passwordResetOtpAttempts = 0;
    user.passwordResetVerifiedAt = new Date(now);
    await user.save();
    return res.json({ success: true, message: 'Verification successful.' });
  } catch (error) {
    console.error('Password reset verification failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to verify the code. Please try again later.' });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const normalizedEmail = String(req.body?.email || '').trim().toLowerCase();
    const newPassword = String(req.body?.newPassword || '');
    if (!EMAIL_PATTERN.test(normalizedEmail) || !PASSWORD_PATTERN.test(newPassword)) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.'
      });
    }

    const user = await User.findOne({ email: normalizedEmail })
      .select('+passwordResetVerifiedAt');
    const verifiedAt = user?.passwordResetVerifiedAt?.getTime() || 0;
    if (!user || Date.now() - verifiedAt > RESET_VERIFICATION_TTL_MS) {
      return res.status(400).json({ success: false, message: 'Your verification has expired. Please request a new code.' });
    }

    user.password = await hashPassword(newPassword);
    clearPasswordResetState(user);
    await user.save();
    return res.json({ success: true, message: 'Password reset successfully.' });
  } catch (error) {
    console.error('Password reset failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to reset your password. Please try again later.' });
  }
};

// Register Controller
exports.register = async (req, res) => {
  try {
    console.log('📝 Registration attempt:', { ...req.body, password: '***' });
    
    const { fullname, email, password, department, yearLevel, sport, id } = req.body;

    if (!fullname || !password || !id) {
      console.log('❌ Registration failed: Missing required fields');
      return res.status(400).json({ 
        success: false,
        message: 'Please provide all required fields: fullname, password, and ID' 
      });
    }

    if (password.length < 6) {
      console.log('❌ Registration failed: Password too short');
      return res.status(400).json({ 
        success: false,
        message: 'Password must be at least 6 characters long' 
      });
    }

    const trimmedId = id?.trim();

    if (!isValidId(trimmedId)) {
      console.log('❌ Registration failed: Invalid ID format');
      return res.status(400).json({
        success: false,
        message: 'ID must be at least 7 characters long and contain only letters, numbers, or common special characters.'
      });
    }

    const detectedRole = detectRoleFromId(trimmedId);

    if (!detectedRole) {
      console.log('❌ Registration failed: Unable to detect role from ID');
      return res.status(400).json({
        success: false,
        message: 'Unable to determine role from provided ID.'
      });
    }

    const duplicateQuery = [{ id: trimmedId }];
    if (email) duplicateQuery.push({ email });
    const existingUser = await User.findOne({ $or: duplicateQuery });

    if (existingUser) {
      if (email && existingUser.email === email) {
        console.log('❌ Registration failed: Email already exists');
        return res.status(400).json({ 
          success: false,
          message: 'Email already registered' 
        });
      }

      if (existingUser.id === trimmedId) {
        console.log('❌ Registration failed: User ID already exists');
        return res.status(400).json({ 
          success: false,
          message: 'User ID already exists' 
        });
      }
    }

    const hashedPassword = await hashPassword(password);

    const userPayload = {
      fullname,
      email: email || '',
      password: hashedPassword,
      role: detectedRole,
      id: trimmedId
    };

    if (detectedRole !== 'admin') {
      userPayload.department = department || '';
      userPayload.yearLevel = yearLevel || '';
      userPayload.sport = sport || '';
    }

    const user = await User.create(userPayload);

    console.log(`✅ User registered successfully: ${user.id} (${user.role})`);

    res.status(201).json({
      success: true,
      message: `Registration successful as ${user.role}. Please login with your credentials.`,
      user: buildUserResponse(user, user.role)
    });

  } catch (error) {
    console.error('❌ Registration error:', error);

    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({ 
        success: false,
        message: `${field} already exists` 
      });
    }

    res.status(500).json({ 
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

    // Find user by ID
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

    // Check password
    const passwordCheck = await verifyPassword(password, user.password);

    if (!passwordCheck.valid) {
      return res.status(401).json({
        success: false,
        message: 'Incorrect password for this account.'
      });
    }

    if (passwordCheck.needsRehash) {
      user.password = await hashPassword(password);
    }

    const detectedRole = detectRoleFromId(user.id);
    let userRole = detectedRole || user.role?.toString().trim().toLowerCase();

    if (!userRole || !['student', 'coach', 'admin', 'screener'].includes(userRole)) {
      userRole = 'student';
    }

    if (user.role !== userRole) {
      user.role = userRole;
    }

    user.lastActiveAt = new Date();
    user.status = 'Active';
    if (typeof user.save === 'function') {
      await user.save();
    }

    if (user.role !== userRole) {
      console.log(`🔄 Updated user role from ${user.role} to: ${userRole}`);
    }

    // CRITICAL FIX: Generate JWT with correct role
    const token = jwt.sign(
      {
        id: user._id,
        userId: user._id,
        role: userRole,
        email: user.email || '',
      },
      getJWTSecret(),
      { expiresIn: '7d' }
    );

    console.log(`✅ Login successful: ${user.id} (${userRole})`);

    // Return success with user data
    res.json({
      success: true,
      message: `Welcome back, ${user.fullname}!`,
      token,
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