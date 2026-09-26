const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { getJWTSecret } = require('../config/security');
const {
  ACCESS_COOKIE_NAME,
  IS_CROSS_SITE_COOKIE_MODE,
  getAuthCookie,
  getPortalRole,
  normalizePortalRole,
  isCsrfTokenValid,
} = require('../config/authTokens');

const ACTIVITY_UPDATE_INTERVAL_MS = 5 * 60 * 1000;

exports.protect = async (req, res, next) => {
  const method = String(req.method || '').toUpperCase();
  const isStateChanging = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const requestedPortalRole = req.get?.('x-portal-role') || req.headers?.['x-portal-role'];
  const portalRole = getPortalRole(req);

  if (requestedPortalRole && !normalizePortalRole(requestedPortalRole)) {
    return res.status(400).json({ success: false, message: 'Invalid portal role context.' });
  }

  if (IS_CROSS_SITE_COOKIE_MODE && isStateChanging
    && getAuthCookie(req, ACCESS_COOKIE_NAME).value && !isCsrfTokenValid(req)) {
    return res.status(403).json({ success: false, message: 'Request could not be verified.' });
  }

  const authorization = req.headers.authorization || '';
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
  const token = getAuthCookie(req, ACCESS_COOKIE_NAME).value || bearerMatch?.[1]?.trim();

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
        ? userQuery.select('-password +passwordChangedAt')
        : userQuery);
    } catch (lookupError) {
      // Legacy login IDs are strings and cannot be cast by findById.
      if (!userId || !/Cast to ObjectId/i.test(lookupError.message || '')) {
        throw lookupError;
      }
      const legacyUserQuery = User.findOne({ $or: [{ _id: userId }, { id: userId }] });
      user = await (legacyUserQuery && typeof legacyUserQuery.select === 'function'
        ? legacyUserQuery.select('+passwordChangedAt')
        : legacyUserQuery);
    }
    
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    const passwordChangedAt = user.passwordChangedAt ? new Date(user.passwordChangedAt).getTime() : 0;
    if (passwordChangedAt && Number.isFinite(decoded.iat) && decoded.iat * 1000 < passwordChangedAt) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized to access this route'
      });
    }

    if (user.accountStatus === 'archived') {
      return res.status(403).json({
        success: false,
        message: 'This account has been archived.'
      });
    }

    const storedRole = String(user.role || '').trim().toLowerCase();
    if (!['student', 'student-athlete', 'studentathlete', 'admin', 'coach', 'screener'].includes(storedRole)) {
      return res.status(403).json({
        success: false,
        message: 'This account does not have an authorized role.'
      });
    }

    if (portalRole && normalizePortalRole(storedRole) !== portalRole) {
      return res.status(401).json({
        success: false,
        message: 'The active session does not match this portal.'
      });
    }

    const now = Date.now();
    const lastActiveAt = user.lastActiveAt ? new Date(user.lastActiveAt).getTime() : 0;
    if (user.status !== 'Active' || !Number.isFinite(lastActiveAt)
      || now - lastActiveAt >= ACTIVITY_UPDATE_INTERVAL_MS) {
      try {
        await User.updateOne(
          { _id: user._id },
          { $set: { lastActiveAt: new Date(now), status: 'Active' } }
        );
      } catch {
        console.warn('User activity update failed');
      }
    }

    const userData = user.toObject ? user.toObject() : { ...user };
    delete userData.password;
    delete userData.passwordChangedAt;
    const databaseRole = User.normalizeRole
      ? User.normalizeRole(storedRole)
      : storedRole;

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