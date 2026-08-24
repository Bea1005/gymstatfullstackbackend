const jwt = require('jsonwebtoken');
const User = require('../models/User');

const getJWTSecret = () => process.env.JWT_SECRET || 'your_super_secret_key_change_this_in_production';

exports.protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    console.log('❌ No token provided');
    return res.status(401).json({ 
      success: false, 
      message: 'Not authorized to access this route' 
    });
  }

  try {
    const decoded = jwt.verify(token, getJWTSecret());
    console.log('🔑 Token decoded:', { userId: decoded.id, role: decoded.role });
    
    // Handle both _id and id fields
    const userId = decoded.id || decoded.userId;
    const user = await User.findById(userId).select('-password');
    
    if (!user) {
      console.log('❌ User not found for ID:', userId);
      return res.status(401).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    user.lastActiveAt = new Date();
    user.status = 'Active';
    if (typeof user.save === 'function') {
      await user.save();
    }

    // CRITICAL FIX: Use the role from token, not from database
    // The token has the correct role, use that
    const userData = user.toObject ? user.toObject() : { ...user };
    req.user = {
      ...userData,
      role: decoded.role || user.role
    };
    
    console.log('✅ User authenticated:', { userId: req.user._id, role: req.user.role });
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(401).json({ 
      success: false, 
      message: 'Not authorized to access this route' 
    });
  }
};

// CRITICAL FIX: Proper role authorization
exports.authorize = (...roles) => {
  return (req, res, next) => {
    // Get the user role from the request
    const userRole = req.user?.role?.toLowerCase();
    
    // Convert all roles to lowercase for comparison
    const allowedRoles = roles.map(r => r.toLowerCase());
    
    const stack = new Error().stack.split('\n').slice(2,7).map(s => s.trim());
    console.log('🔐 Authorization check:', { 
      path: req.originalUrl,
      method: req.method,
      userRole, 
      allowedRoles,
      hasAccess: userRole && allowedRoles.includes(userRole),
      calledFrom: stack
    });
    
    // Check if user has any of the allowed roles
    if (!userRole) {
      console.log('❌ No user role found');
      return res.status(403).json({ 
        success: false, 
        message: 'No user role found' 
      });
    }
    
    // CRITICAL FIX: Check if user role matches any allowed role
    if (!allowedRoles.includes(userRole)) {
      console.log(`❌ Access denied: ${req.method} ${req.originalUrl} - Role "${userRole}" not in [${allowedRoles.join(', ')}]`);
      return res.status(403).json({ 
        success: false, 
        message: `Role ${userRole} is not authorized to access this route. Required roles: ${allowedRoles.join(', ')}` 
      });
    }
    
    console.log('✅ Authorization successful for role:', userRole);
    next();
  };
};