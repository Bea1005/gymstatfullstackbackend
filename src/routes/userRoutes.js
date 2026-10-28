const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const { hashPassword, isPasswordValid, PASSWORD_POLICY_MESSAGE } = require('../config/passwords');
const { getJWTSecret } = require('../config/security');
const { sendRegistrationVerificationOtp, sendScreenerAuthorizationEmail } = require('../config/email');
const ScreenerAuthorization = require('../models/ScreenerAuthorization');
const router = express.Router();
const User = require('../models/User');
const { protect, authorize } = require('../middleware/auth');

const VALID_ROLES = ['student', 'coach', 'admin', 'screener'];
const DUPLICATE_ID_MESSAGE = 'This ID is already registered. Please use a different ID.';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REGISTRATION_OTP_TTL_MS = 10 * 60 * 1000;
const SCREENER_ID_PATTERN = /^S(\d{6,})$/;
const SCREENER_ID_CREATION_ATTEMPTS = 25;

const hashRegistrationOtp = (otp) => crypto
  .createHmac('sha256', getJWTSecret())
  .update(String(otp))
  .digest('hex');

const getNextScreenerId = async (minimumNumber = 1) => {
  const screeners = await User.find({
    role: 'screener',
    id: { $regex: /^S\d{6,}$/ }
  }).select('id').lean();
  const highestNumber = (Array.isArray(screeners) ? screeners : []).reduce((highest, screener) => {
    const match = SCREENER_ID_PATTERN.exec(String(screener?.id || ''));
    const number = match ? Number(match[1]) : 0;
    return Number.isSafeInteger(number) ? Math.max(highest, number) : highest;
  }, 0);

  return `S${String(Math.max(highestNumber + 1, minimumNumber)).padStart(6, '0')}`;
};

const isDuplicateIdError = (error) => error?.code === 11000
  && (error.keyPattern?.id || Object.prototype.hasOwnProperty.call(error.keyValue || {}, 'id'));

const normalizeRole = (role) => {
  const normalized = String(role || '').trim().toLowerCase();
  return VALID_ROLES.includes(normalized) ? normalized : 'student';
};

const getUserActivityStatus = (userObject) => {
  const explicitStatus = userObject?.status;
  if (explicitStatus === 'Active' || explicitStatus === 'Inactive') {
    return explicitStatus;
  }

  const lastActiveAt = userObject?.lastActiveAt || userObject?.lastLoginAt || userObject?.lastSeenAt;
  if (!lastActiveAt) return 'Inactive';

  const lastActiveDate = new Date(lastActiveAt);
  if (Number.isNaN(lastActiveDate.getTime())) return 'Inactive';

  const activeWindowMs = 15 * 60 * 1000;
  return Date.now() - lastActiveDate.getTime() <= activeWindowMs ? 'Active' : 'Inactive';
};

const getAccountStatus = (userObject) => userObject?.accountStatus === 'archived' ? 'archived' : 'active';

const mapUserToResponse = (user) => {
  const userObject = user.toObject ? user.toObject() : user;
  const {
    password,
    __v,
    emailNormalized,
    registrationOtpHash,
    registrationOtpExpiresAt,
    registrationOtpAttempts,
    registrationOtpLastSentAt,
    registrationOtpResendCount,
    passwordResetOtpHash,
    passwordResetOtpExpiresAt,
    passwordResetOtpAttempts,
    passwordResetLastSentAt,
    passwordResetTokenHash,
    passwordResetTokenExpiresAt,
    passwordResetTokenConsumedAt,
    ...rest
  } = userObject;
  const isAdmin = String(userObject.role || '').trim().toLowerCase() === 'admin';

  if (isAdmin) {
    return {
      _id: userObject._id?.toString(),
      id: userObject.id || userObject._id?.toString(),
      fullname: userObject.fullname || '',
      email: userObject.email || '',
      accountStatus: getAccountStatus(userObject),
      role: userObject.role || 'admin'
    };
  }

  const response = {
    ...rest,
    id: userObject.id || userObject._id?.toString(),
    _id: userObject._id?.toString(),
    name: userObject.fullname || '',
    fullname: userObject.fullname || '',
    email: userObject.email || '',
    accountStatus: getAccountStatus(userObject),
    status: getUserActivityStatus(userObject),
    role: userObject.role || 'student'
  };

  response.dept = userObject.department || '';
  response.department = userObject.department || '';
  response.sport = userObject.sport || '';

  return response;
};

const getRequestedRole = (req) => {
  const roleFromQuery = String(req.query.role || '').trim().toLowerCase();
  if (VALID_ROLES.includes(roleFromQuery)) {
    return roleFromQuery;
  }

  if (req.baseUrl && req.baseUrl.includes('/screeners')) {
    return 'screener';
  }

  if (req.baseUrl && req.baseUrl.includes('/students')) {
    return 'student';
  }

  return null;
};

const findUserByIdentifier = async (identifier) => {
  if (!identifier) return null;
  
  const query = mongoose.Types.ObjectId.isValid(identifier)
    ? { $or: [{ id: identifier }, { _id: identifier }] }
    : { id: identifier };
  return User.findOne(query);
};

// @desc    Create a new user account (used by admin for students/screeners)
// @route   POST /api/v1/users
// @access  Private/Admin
router.post('/', protect, authorize('admin'), async (req, res) => {
  try {
    const rawId = typeof req.body?.id === 'string' ? req.body.id.trim() : '';
    const rawFullname = typeof req.body?.fullname === 'string' ? req.body.fullname.trim() : '';
    const rawEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const rawPassword = typeof req.body?.password === 'string' ? req.body.password : '';
    const rawDepartment = typeof req.body?.department === 'string' ? req.body.department.trim() : '';
    const rawSport = typeof req.body?.sport === 'string' ? req.body.sport.trim() : '';
    const requestedRole = normalizeRole(req.body?.role || getRequestedRole(req) || 'student');

    // Validate required fields
    if (requestedRole !== 'screener' && !rawId) {
      return res.status(400).json({
        success: false,
        message: 'ID is required.'
      });
    }

    if (!rawEmail) {
      return res.status(400).json({
        success: false,
        message: 'Email is required.'
      });
    }

    if (!EMAIL_PATTERN.test(rawEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address.'
      });
    }

    if (!rawPassword) {
      return res.status(400).json({
        success: false,
        message: 'Password is required.'
      });
    }

    if (!isPasswordValid(rawPassword)) {
      return res.status(400).json({
        success: false,
        message: PASSWORD_POLICY_MESSAGE
      });
    }

    if (requestedRole !== 'screener' && await User.hasRegisteredId(rawId)) {
      return res.status(409).json({
        success: false,
        message: DUPLICATE_ID_MESSAGE
      });
    }

    await User.ensureEmailIndex();
    if (await User.hasRegisteredEmail(rawEmail)) {
      return res.status(409).json({
        success: false,
        message: 'A user with this Email already exists. Please use a different email.'
      });
    }

    const hashedPassword = await hashPassword(rawPassword);
    const otp = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const otpHash = hashRegistrationOtp(otp);
    const now = Date.now();
    const userPayload = {
      email: rawEmail,
      emailNormalized: rawEmail,
      emailVerified: false,
      registrationOtpHash: otpHash,
      registrationOtpExpiresAt: new Date(now + REGISTRATION_OTP_TTL_MS),
      registrationOtpAttempts: 0,
      registrationOtpLastSentAt: new Date(now),
      registrationOtpResendCount: 0,
      password: hashedPassword,
      role: requestedRole,
      ...(requestedRole !== 'screener' && { id: rawId }),
      status: 'Inactive',
      accountStatus: 'active',
      lastActiveAt: null
    };

    if (requestedRole !== 'screener') {
      userPayload.fullname = rawFullname || rawId;
    }

    if (requestedRole !== 'admin') {
      userPayload.department = rawDepartment || '';
      userPayload.sport = rawSport || '';
    }

    let user;
    if (requestedRole === 'screener') {
      let minimumNumber = 1;
      for (let attempt = 0; attempt < SCREENER_ID_CREATION_ATTEMPTS; attempt += 1) {
        const generatedId = await getNextScreenerId(minimumNumber);
        const screenerPayload = {
          ...userPayload,
          id: generatedId,
          fullname: rawFullname || generatedId
        };

        try {
          user = await User.create(screenerPayload);
          break;
        } catch (error) {
          if (!isDuplicateIdError(error)) throw error;
          minimumNumber = Number(generatedId.slice(1)) + 1;
        }
      }

      if (!user) {
        return res.status(503).json({
          success: false,
          message: 'Unable to allocate a Screener ID right now. Please try again.'
        });
      }
    } else {
      user = await User.create(userPayload);
    }

    try {
      await sendRegistrationVerificationOtp(rawEmail, otp, REGISTRATION_OTP_TTL_MS / 60000);
    } catch {
      if (requestedRole === 'screener') {
        await User.deleteOne({ _id: user._id });
        await User.getRoleModel('screener').deleteOne({ userId: user._id });
      } else {
        await User.updateOne(
          { _id: user._id, registrationOtpHash: otpHash },
          {
            $set: {
              registrationOtpHash: null,
              registrationOtpExpiresAt: null,
              registrationOtpAttempts: 0,
              registrationOtpLastSentAt: null,
              registrationOtpResendCount: 0
            }
          }
        );
      }
      console.error('Admin-provisioned registration verification email delivery failed.');
      return res.status(503).json({
        success: false,
        safeError: 'registration-email-delivery',
        verificationRequired: requestedRole !== 'screener',
        message: requestedRole === 'screener'
          ? 'The verification email could not be sent, so the Screener account was not created. Please try again later.'
          : 'The account is pending email verification, but the verification email could not be sent. The user can retry from the Registration Page.'
      });
    }

    res.status(201).json({
      success: true,
      verificationRequired: true,
      message: `${requestedRole.charAt(0).toUpperCase() + requestedRole.slice(1)} account created. Email verification is required before login.`,
      user: mapUserToResponse(user)
    });
  } catch (error) {
    console.error('Create user error:', error);
    
    if (error.code === 11000) {
      if (error.keyPattern?.id || Object.prototype.hasOwnProperty.call(error.keyValue || {}, 'id')) {
        return res.status(409).json({
          success: false,
          message: DUPLICATE_ID_MESSAGE
        });
      }

      const field = Object.keys(error.keyPattern || error.keyValue || {})[0] || 'Field';
      return res.status(409).json({
        success: false,
        message: `A user with this ${field} already exists. Please use a different ${field}.`
      });
    }
    
    res.status(400).json({ 
      success: false, 
      message: 'An unexpected server error occurred. Please try again.'
    });
  }
});

// @desc    List students
// @route   GET /api/v1/users/students
// @access  Private/Admin
router.get('/students', protect, authorize('admin'), async (req, res) => {
  try {
    const accountStatus = req.query.accountStatus === 'archived' ? 'archived' : 'active';
    const users = await User.find({ role: 'student', accountStatus })
      .select('-password -__v')
      .sort({ createdAt: -1 });
    res.json(users.map(mapUserToResponse));
  } catch (error) {
    console.error('List students error:', error);
    res.status(400).json({ 
      success: false,
      message: 'An unexpected server error occurred. Please try again.'
    });
  }
});

// @desc    Create a student account
// @route   POST /api/v1/users/students
// @access  Private/Admin
router.post('/students', protect, authorize('admin'), async (req, res) => {
  req.body.role = 'student';
  // Forward to the main create endpoint
  const handler = router.handle.bind(router);
  return handler({
    ...req,
    method: 'POST',
    url: '/'
  }, res);
});

// @desc    List screeners
// @route   GET /api/v1/users/screeners
// @access  Private/Admin

// POST /screeners/send-authorization — admin sends authorization email to screener
router.post('/screeners/send-authorization', protect, authorize('admin'), async (req, res) => {
  try {
    const rawId = typeof req.body.screenerUserId === 'string' ? req.body.screenerUserId.trim() : '';
    if (!rawId) return res.status(400).json({ success: false, message: 'screenerUserId is required.' });

    const screener = await User.findOne({ _id: rawId, role: 'screener' }).select('_id id fullname email emailVerified');
    if (!screener) return res.status(404).json({ success: false, message: 'Screener account not found.' });
    if (screener.emailVerified) return res.status(409).json({ success: false, message: 'This screener has already confirmed their authorization.' });

    const rawToken = require('crypto').randomBytes(32).toString('hex');
    const tokenHash = require('crypto').createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    await ScreenerAuthorization.deleteMany({ screenerUserId: screener._id });
    await ScreenerAuthorization.create({ screenerUserId: screener._id, tokenHash, expiresAt });

    const frontendUrl = (process.env.FRONTEND_URL || process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:5173').split(',')[0].trim().replace(/\/$/, '');
    const confirmUrl = frontendUrl + '/screener/confirm-authorization?token=' + rawToken;

    await sendScreenerAuthorizationEmail(screener.email, screener.fullname || screener.id || 'Screener', confirmUrl);
    return res.json({ success: true, message: 'Authorization email sent to ' + screener.email + '.' });
  } catch (error) {
    console.error('Send screener authorization error:', error);
    return res.status(503).json({ success: false, message: error.message || 'Failed to send authorization email.' });
  }
});

// GET /screeners/confirm-authorization?token=... — screener clicks OK I Agree
router.get('/screeners/confirm-authorization', async (req, res) => {
  try {
    const rawToken = typeof req.query.token === 'string' ? req.query.token.trim() : '';
    if (!rawToken) return res.status(400).json({ success: false, message: 'Authorization token is missing.' });

    const tokenHash = require('crypto').createHash('sha256').update(rawToken).digest('hex');
    const record = await ScreenerAuthorization.findOne({ tokenHash });
    if (!record) return res.status(400).json({ success: false, message: 'This authorization link is invalid or has already been used.' });
    if (record.confirmedAt) return res.status(409).json({ success: false, message: 'You have already accepted this authorization.' });
    if (record.expiresAt < new Date()) return res.status(410).json({ success: false, message: 'This authorization link has expired. Ask the administrator to resend it.' });

    record.confirmedAt = new Date();
    await record.save();
    await User.updateOne({ _id: record.screenerUserId, role: 'screener' }, { ['$set']: { emailVerified: true } });

    const screener = await User.findOne({ _id: record.screenerUserId }).select('id fullname email');
    return res.json({ success: true, message: 'Authorization confirmed. You may now log in to GYMSTAT as a Screener.', screener: { id: screener && screener.id, fullname: screener && screener.fullname, email: screener && screener.email } });
  } catch (error) {
    console.error('Screener confirm authorization error:', error);
    return res.status(500).json({ success: false, message: 'An unexpected error occurred. Please try again.' });
  }
});

router.get('/screeners/next-id', protect, authorize('admin'), async (_req, res) => {
  try {
    const id = await getNextScreenerId();
    return res.json({ success: true, id });
  } catch (error) {
    console.error('Get next Screener ID error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to load the next Screener ID. Please try again.'
    });
  }
});

router.get('/screeners', protect, authorize('admin'), async (req, res) => {
  try {
    const accountStatus = req.query.accountStatus === 'archived' ? 'archived' : 'active';
    const users = await User.find({ role: 'screener', accountStatus })
      .select('-password -__v')
      .sort({ createdAt: -1 });
    res.json(users.map(mapUserToResponse));
  } catch (error) {
    console.error('List screeners error:', error);
    res.status(400).json({ 
      success: false,
      message: 'An unexpected server error occurred. Please try again.'
    });
  }
});

// @desc    Create a screener account
// @route   POST /api/v1/users/screeners
// @access  Private/Admin
router.post('/screeners', protect, authorize('admin'), async (req, res) => {
  req.body.role = 'screener';
  // Forward to the main create endpoint
  const handler = router.handle.bind(router);
  return handler({
    ...req,
    method: 'POST',
    url: '/'
  }, res);
});

// @desc    Archive many users by ID
// @route   PATCH /api/v1/users/archive
// @access  Private/Admin
router.patch('/archive', protect, authorize('admin'), async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Boolean) : [];

    if (!ids.length) {
      return res.status(400).json({ 
        success: false, 
        message: 'No user IDs provided.' 
      });
    }

    const result = await User.updateMany(
      { id: { $in: ids }, role: { $in: ['student', 'screener'] }, accountStatus: { $ne: 'archived' } },
      { $set: { accountStatus: 'archived' } }
    );
    res.json({ 
      success: true, 
      archivedCount: result.modifiedCount,
      message: `Successfully archived ${result.modifiedCount} user(s)`
    });
  } catch (error) {
    console.error('Bulk delete error:', error);
    res.status(400).json({ 
      success: false, 
      message: 'An unexpected server error occurred. Please try again.'
    });
  }
});

// @desc    Update user by ID
// @route   PUT /api/v1/users/:id
// @access  Private/Admin
router.put('/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { fullname, email, role, department, sport } = req.body;

    const user = await findUserByIdentifier(id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check for duplicate email
    if (email) {
      const duplicateQuery = [];
      if (email) duplicateQuery.push({ email, _id: { $ne: user._id } });
      
      if (duplicateQuery.length > 0) {
        const existing = await User.findOne({ $or: duplicateQuery });
        if (existing) {
          return res.status(409).json({
            success: false,
            message: 'Email already exists. Please use a different email.'
          });
        }
      }
    }

    const isAdminUser = String(user.role || '').trim().toLowerCase() === 'admin';

    // Update fields
    if (fullname) user.fullname = fullname;
    if (email !== undefined) user.email = email;
    if (role) user.role = normalizeRole(role);
    if (!isAdminUser && department !== undefined) user.department = department;
    if (!isAdminUser && sport !== undefined) user.sport = sport;

    await user.save();

    res.json({
      success: true,
      message: 'User updated successfully',
      user: mapUserToResponse(user)
    });
  } catch (error) {
    console.error('Update user error:', error);

    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({
        success: false,
        message: `${field} already exists. Please use a different ${field}.`
      });
    }

    res.status(400).json({
      success: false,
      message: 'An unexpected server error occurred. Please try again.'
    });
  }
});

// @desc    Archive or restore a student/screener account
// @route   PATCH /api/v1/users/:id/archive|restore
// @access  Private/Admin
router.patch('/:id/:action(archive|restore)', protect, authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const accountStatus = req.params.action === 'restore' ? 'active' : 'archived';
    
    const user = await findUserByIdentifier(id);

    if (!user) {
      console.log('❌ User not found with ID:', id);
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    if (!['student', 'screener'].includes(String(user.role || '').toLowerCase())) {
      return res.status(400).json({ success: false, message: 'Only student and screener accounts can be archived or restored.' });
    }

    user.accountStatus = accountStatus;
    await user.save();
    
    res.json({ 
      success: true, 
      accountStatus,
      message: accountStatus === 'archived' ? 'User account archived successfully.' : 'User account restored successfully.'
    });
  } catch (error) {
    console.error('❌ Delete user error:', error);
    res.status(400).json({ 
      success: false, 
      message: 'An unexpected server error occurred. Please try again.'
    });
  }
});

// @desc    Get user by ID
// @route   GET /api/v1/users/:id
// @access  Private/Admin
router.get('/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const user = await findUserByIdentifier(id);

    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    res.json(mapUserToResponse(user));
  } catch (error) {
    console.error('Get user error:', error);
    res.status(400).json({ 
      success: false,
      message: 'An unexpected server error occurred. Please try again.'
    });
  }
});

// @desc    Get all users
// @route   GET /api/v1/users
// @access  Private/Admin
router.get('/', protect, authorize('admin'), async (req, res) => {
  try {
    console.log('✅ GET /users - User role:', req.user?.role);
    const roleFilter = getRequestedRole(req);
    const accountStatus = req.query.accountStatus === 'archived' ? 'archived' : 'active';
    const filter = roleFilter ? { role: roleFilter, accountStatus } : { accountStatus };
    const users = await User.find(filter)
      .select('-password -__v')
      .sort({ createdAt: -1 })
      .lean();
    console.log(`✅ Found ${users.length} users with filter:`, filter);
    res.json(users.map(mapUserToResponse));
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'An unexpected server error occurred. Please try again.'
    });
  }
});

module.exports = router;