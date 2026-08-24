const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
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

const mapUserToResponse = (user) => {
  const userObject = user.toObject ? user.toObject() : user;
  const { password, __v, ...rest } = userObject;
  const isAdmin = String(userObject.role || '').trim().toLowerCase() === 'admin';

  if (isAdmin) {
    return {
      _id: userObject._id?.toString(),
      id: userObject.id || userObject._id?.toString(),
      fullname: userObject.fullname || userObject.username || '',
      username: userObject.username || '',
      email: userObject.email || '',
      role: userObject.role || 'admin'
    };
  }

  const response = {
    ...rest,
    id: userObject.id || userObject._id?.toString(),
    _id: userObject._id?.toString(),
    name: userObject.fullname || userObject.username || '',
    fullname: userObject.fullname || userObject.username || '',
    username: userObject.username || '',
    email: userObject.email || '',
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
    const rawUsername = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
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
    const username = rawUsername || rawId;

    // Check for existing user - check all unique fields
    const existingUser = await User.findOne({
      $or: [
        { id: rawId },
        { username: username },
        { email: rawEmail }
      ]
    });

    if (existingUser) {
      let fieldName = '';
      if (existingUser.id === rawId) fieldName = 'ID';
      else if (existingUser.username === username) fieldName = 'Username';
      else if (existingUser.email === rawEmail) fieldName = 'Email';
      
      return res.status(409).json({
        success: false,
        message: `A user with this ${fieldName} already exists. Please use a different ${fieldName.toLowerCase()}.`
      });
    }

    // Hash password and create user
    const hashedPassword = await bcrypt.hash(rawPassword, 10);
    const userPayload = {
      fullname,
      username,
      email: rawEmail,
      password: hashedPassword,
      role: requestedRole,
      id: rawId,
      status: 'Inactive',
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
      message: error.message || 'Failed to create user'
    });
  }
});

// @desc    List students
// @route   GET /api/v1/users/students
// @access  Private/Admin
router.get('/students', protect, authorize('admin'), async (req, res) => {
  try {
    const users = await User.find({ role: 'student' })
      .select('-password -__v')
      .sort({ createdAt: -1 });
    res.json(users.map(mapUserToResponse));
  } catch (error) {
    console.error('List students error:', error);
    res.status(400).json({ 
      success: false,
      message: error.message 
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
    const users = await User.find({ role: 'screener' })
      .select('-password -__v')
      .sort({ createdAt: -1 });
    res.json(users.map(mapUserToResponse));
  } catch (error) {
    console.error('List screeners error:', error);
    res.status(400).json({ 
      success: false,
      message: error.message 
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

// @desc    Delete many users by ID
// @route   DELETE /api/v1/users/bulk-delete
// @access  Private/Admin
router.delete('/bulk-delete', protect, authorize('admin'), async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Boolean) : [];

    if (!ids.length) {
      return res.status(400).json({ 
        success: false, 
        message: 'No user IDs provided.' 
      });
    }

    const deleteQuery = {
      id: { $in: ids }
    };

    console.log('Bulk deleting users with IDs:', ids);
    const result = await User.deleteMany(deleteQuery);
    console.log('Bulk delete result - deleted count:', result.deletedCount);
    res.json({ 
      success: true, 
      deletedCount: result.deletedCount,
      message: `Successfully deleted ${result.deletedCount} user(s)`
    });
  } catch (error) {
    console.error('Bulk delete error:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// @desc    Update user by ID
// @route   PUT /api/v1/users/:id
// @access  Private/Admin
router.put('/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { username, fullname, email, role, department, sport } = req.body;

    const user = await findUserByIdentifier(id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check for duplicate username/email
    if (username || email) {
      const duplicateQuery = [];
      if (username) duplicateQuery.push({ username, _id: { $ne: user._id } });
      if (email) duplicateQuery.push({ email, _id: { $ne: user._id } });
      
      if (duplicateQuery.length > 0) {
        const existing = await User.findOne({ $or: duplicateQuery });
        if (existing) {
          const fieldName = existing.username === username ? 'Username' : 'Email';
          return res.status(409).json({
            success: false,
            message: `${fieldName} already exists. Please use a different ${fieldName.toLowerCase()}.`
          });
        }
      }
    }

    const isAdminUser = String(user.role || '').trim().toLowerCase() === 'admin';

    // Update fields
    if (username) user.username = username;
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
      message: error.message
    });
  }
});

// @desc    Delete user by ID
// @route   DELETE /api/v1/users/:id
// @access  Private/Admin
router.delete('/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    console.log('📦 Delete request - ID:', id);
    
    const user = await findUserByIdentifier(id);

    if (!user) {
      console.log('❌ User not found with ID:', id);
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    console.log('✅ Found user:', user._id, '- Role:', user.role);
    const deleteResult = await User.deleteOne({ _id: user._id });
    console.log('✅ Delete result:', deleteResult);
    
    res.json({ 
      success: true, 
      message: 'User deleted successfully' 
    });
  } catch (error) {
    console.error('❌ Delete user error:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message 
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
      message: error.message 
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
    const filter = roleFilter ? { role: roleFilter } : {};
    const users = await User.find(filter)
      .select('-password -__v')
      .sort({ createdAt: -1 });
    console.log(`✅ Found ${users.length} users with filter:`, filter);
    res.json(users.map(mapUserToResponse));
  } catch (error) {
    console.error('Get users error:', error);
    res.status(400).json({ 
      success: false,
      message: error.message 
    });
  }
});

module.exports = router;