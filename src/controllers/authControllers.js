const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

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

const getJWTSecret = () => process.env.JWT_SECRET || 'your_super_secret_key_change_this_in_production';

const buildUserResponse = (user, roleOverride) => {
  const resolvedRole = String(roleOverride || user?.role || 'student').trim().toLowerCase();

  if (resolvedRole === 'admin') {
    return {
      _id: user._id,
      fullname: user.fullname,
      username: user.username,
      email: user.email || '',
      notifications: user.notifications !== undefined ? user.notifications : true,
      role: resolvedRole,
      id: user.id
    };
  }

  return {
    _id: user._id,
    fullname: user.fullname,
    username: user.username,
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

exports.forgotPassword = async (req, res) => {
  try {
    const trimmedId = String(req.body?.id || '').trim();
    const normalizedEmail = String(req.body?.email || '').trim().toLowerCase();
    const newPassword = req.body?.newPassword;

    if (!trimmedId || !normalizedEmail || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide your ID, registered email, and a new password.'
      });
    }

    if (String(newPassword).length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters long.'
      });
    }

    const user = await User.findOne({ id: trimmedId });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No account found for that ID.'
      });
    }

    if (String(user.email || '').trim().toLowerCase() !== normalizedEmail) {
      return res.status(404).json({
        success: false,
        message: 'The provided ID and email do not match an existing account.'
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    user.password = hashedPassword;
    await user.save();

    return res.json({
      success: true,
      message: 'Password reset successful. You can now log in with your new password.'
    });
  } catch (error) {
    console.error('❌ Forgot password error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while resetting password. Please try again.'
    });
  }
};

// Register Controller
exports.register = async (req, res) => {
  try {
    console.log('📝 Registration attempt:', { ...req.body, password: '***' });
    
    const { fullname, username, email, password, department, yearLevel, sport, id } = req.body;

    if (!fullname || !username || !password || !id) {
      console.log('❌ Registration failed: Missing required fields');
      return res.status(400).json({ 
        success: false,
        message: 'Please provide all required fields: fullname, username, password, and ID' 
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

    let existingUser;
    if (email) {
      existingUser = await User.findOne({ 
        $or: [{ email }, { username }, { id: trimmedId }] 
      });
    } else {
      existingUser = await User.findOne({ 
        $or: [{ username }, { id: trimmedId }] 
      });
    }

    if (existingUser) {
      if (email && existingUser.email === email) {
        console.log('❌ Registration failed: Email already exists');
        return res.status(400).json({ 
          success: false,
          message: 'Email already registered' 
        });
      }

      if (existingUser.username === username) {
        console.log('❌ Registration failed: Username already taken');
        return res.status(400).json({ 
          success: false,
          message: 'Username already taken' 
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

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const userPayload = {
      fullname,
      username,
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
    console.log('🔐 Login attempt for ID:', req.body.id);

    const id = req.body.id?.trim();
    const password = req.body.password;

    if (!id || !password) {
      console.log('❌ Login failed: Missing credentials');
      return res.status(400).json({ 
        success: false,
        message: 'Please provide ID and password' 
      });
    }

    // Find user by ID
    const user = await User.findOne({ id });

    if (!user) {
      console.log(`❌ Login failed: User not found with ID: ${id}`);
      return res.status(401).json({
        success: false,
        message: 'No account found for this ID.'
      });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      console.log(`❌ Login failed: Incorrect password for ID: ${id}`);
      return res.status(401).json({
        success: false,
        message: 'Incorrect password for this account.'
      });
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
        username: user.username
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