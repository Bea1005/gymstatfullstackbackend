const express = require('express');
const mongoose = require('mongoose');
const { hashPassword } = require('../config/passwords');
const router = express.Router();
const User = require('../models/User');
const { protect, authorize } = require('../middleware/auth');

const VALID_ROLES = ['student', 'coach', 'admin', 'screener'];

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
  const { password, __v, ...rest } = userObject;
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
    const rawEmail = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    const rawPassword = typeof req.body?.password === 'string' ? req.body.password : '';
    const rawDepartment = typeof req.body?.department === 'string' ? req.body.department.trim() : '';
    const rawSport = typeof req.body?.sport === 'string' ? req.body.sport.trim() : '';
    const requestedRole = normalizeRole(req.body?.role || getRequestedRole(req) || 'student');

    // Validate required fields
    if (!rawId) {
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

    if (!rawPassword) {
      return res.status(400).json({
        success: false,
        message: 'Password is required.'
      });
    }

    const fullname = rawFullname || rawId;
    // Check for existing user - check all unique fields
    const existingUser = await User.findOne({
      $or: [
        { id: rawId },
        { email: rawEmail }
      ]
    });

    if (existingUser) {
      let fieldName = '';
      if (existingUser.id === rawId) fieldName = 'ID';
      else if (existingUser.email === rawEmail) fieldName = 'Email';
      
      return res.status(409).json({
        success: false,
        message: `A user with this ${fieldName} already exists. Please use a different ${fieldName.toLowerCase()}.`
      });
    }

    // Hash password and create user
    const hashedPassword = await hashPassword(rawPassword);
    const userPayload = {
      fullname,
      email: rawEmail,
      password: hashedPassword,
      role: requestedRole,
      id: rawId,
      status: 'Inactive',
      accountStatus: 'active',
      lastActiveAt: null
    };

    if (requestedRole !== 'admin') {
      userPayload.department = rawDepartment || '';
      userPayload.sport = rawSport || '';
    }

    const user = await User.create(userPayload);

    // Return success with user data
    res.status(201).json({
      success: true,
      message: `${requestedRole.charAt(0).toUpperCase() + requestedRole.slice(1)} account created successfully`,
      user: mapUserToResponse(user)
    });
  } catch (error) {
    console.error('Create user error:', error);
    
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
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
      .sort({ createdAt: -1 });
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