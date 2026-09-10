const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { getJWTSecret } = require('../config/security');

exports.protect = async (req, res, next) => {
  const authorization = req.headers.authorization || '';
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
  const token = bearerMatch?.[1]?.trim();

  if (!token) {
    return res.status(401).json({ 
      success: false, 
      message: 'Not authorized to access this route' 
    });
  }

  try {
    const decoded = jwt.verify(token, getJWTSecret());
    
    // Handle both _id and id fields
    const userId = decoded.id || decoded.userId;
    let user;

    try {
      const userQuery = User.findById(userId);
      user = await (userQuery && typeof userQuery.select === 'function'
        ? userQuery.select('-password')
        : userQuery);
      if (userQuery === undefined) {
        user = decoded;
      }
    } catch (lookupError) {
      // Legacy login IDs are strings and cannot be cast by findById.
      if (!userId || !/Cast to ObjectId/i.test(lookupError.message || '')) {
        throw lookupError;
      }
      user = await User.findOne({ $or: [{ _id: userId }, { id: userId }] });
    }
    
    if (!user) {
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

    const userData = user.toObject ? user.toObject() : { ...user };
    delete userData.password;
    const databaseRole = User.normalizeRole
      ? User.normalizeRole(userData.role)
      : String(userData.role || '').trim().toLowerCase();

    req.user = {
      ...userData,
      role: databaseRole
    };
    
    next();
  } catch (error) {
    console.error('Authentication failed');
    return res.status(401).json({ 
      success: false, 
      message: 'Not authorized to access this route' 
    });
  }
};

exports.authorize = (...roles) => {
  return (req, res, next) => {
    const userRole = req.user?.role?.toLowerCase();
    const allowedRoles = roles.map(r => r.toLowerCase());

    if (!userRole) {
      return res.status(403).json({ 
        success: false, 
        message: 'No user role found' 
      });
    }

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({ 
        success: false, 
        message: `Role ${userRole} is not authorized to access this route. Required roles: ${allowedRoles.join(', ')}` 
      });
    }
    
    console.log('✅ Authorization successful for role:', userRole);
    next();
  };
};