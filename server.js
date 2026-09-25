require('dotenv').config();
const { installSafeConsole } = require('./src/config/logger');
installSafeConsole();
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const connectDB = require('./src/config/db');
const { corsOptions } = require('./src/config/cors');
const { getJWTSecret } = require('./src/config/security');
const { hashPassword, verifyPassword, isPasswordValid, PASSWORD_POLICY_MESSAGE } = require('./src/config/passwords');
const { getEmailConfigurationStatus } = require('./src/config/email');
const { apiRateLimiter } = require('./src/config/rateLimit');
const User = require('./src/models/User');
const StudentProfile = require('./src/models/StudentProfile');
const { deleteProfilePhoto, uploadProfilePhoto, streamProfilePhoto } = require('./src/config/profilePhotoStorage');
const { protect, authorize } = require('./src/middleware/auth');
const { validateRequestBody } = require('./src/middleware/requestValidation');
const { auditSecurityEvents } = require('./src/middleware/securityAudit');

console.log('🔐 Environment Configuration:');
console.log(`   PORT: ${process.env.PORT || 4000}`);
console.log(`   BASE_URI: ${process.env.BASE_URI || '/api/v1'}`);
console.log(`   Password reset email service configured: ${getEmailConfigurationStatus().configured ? 'yes' : 'no'}`);
getJWTSecret();

const authRoutes = require('./src/routes/authRoutes');
const adminRoutes = require('./src/routes/adminRoutes');
const borrowingRoutes = require('./src/routes/borrowingRoutes');
const equipmentRoutes = require('./src/routes/equipmentRoutes');
const screenerRoutes = require('./src/routes/screenerRoutes');
const coachRoutes = require('./src/routes/coachRoutes');
const studentRoutes = require('./src/routes/studentRoutes');
const userRoutes = require('./src/routes/userRoutes');
const scheduleRequestsRouter = require('./src/routes/scheduleRequests');
const scheduleRoutes = require('./src/routes/schedules');
const requirementRoutes = require('./src/routes/requirementRoutes');
const upload = require('./src/config/multer');
const profilePhotoUpload = require('multer')({
  storage: require('multer').memoryStorage(),
  fileFilter: (req, file, callback) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    callback(null, allowedTypes.includes(file.mimetype));
  },
  limits: { fileSize: 5 * 1024 * 1024 },
});

const app = express();
const rawBaseUri = process.env.BASE_URI || '/api/v1';
const BASE_URI = rawBaseUri.replace(/\/+$|^\s+|\s+$/g, '') || '/api/v1';
const PORT_FILE = path.join(__dirname, '.port');
const isProduction = process.env.NODE_ENV === 'production';

const getConfiguredSecurityOrigins = () => String(
  [process.env.CORS_ALLOWED_ORIGINS, process.env.FRONTEND_URL]
    .filter(Boolean)
    .join(',')
)
  .split(',')
  .map((value) => value.trim())
  .filter((value) => {
    try {
      const parsed = new URL(value);
      return ['http:', 'https:'].includes(parsed.protocol)
        && (!isProduction || parsed.protocol === 'https:');
    } catch {
      return false;
    }
  })
  .map((value) => new URL(value).origin);

const cspConnectSources = [...new Set(['\'self\'', ...getConfiguredSecurityOrigins()])].join(' ');

if (isProduction) {
  app.set('trust proxy', 1);
}

app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "form-action 'none'",
      "object-src 'none'",
      "script-src 'none'",
      "style-src 'none'",
      "font-src 'none'",
      "img-src 'self' data: blob:",
      `connect-src ${cspConnectSources}`,
    ].join('; ')
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');

  if (isProduction) {
    const forwardedProtocol = req.get('x-forwarded-proto')?.split(',')[0].trim();
    if (forwardedProtocol === 'https' || req.secure) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
  }

  return next();
});

const writePortFile = (port) => {
  fs.writeFileSync(PORT_FILE, String(port), 'utf8');
};

const listenWithRetry = (preferredPort) => {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      const server = app.listen(port, '0.0.0.0', () => {
        const actualPort = server.address().port;
        resolve(actualPort);
      });

      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.warn(`Port ${port} is busy, trying ${port + 1}...`);
          try {
            server.close();
          } catch {}
          tryPort(port + 1);
        } else {
          reject(err);
        }
      });
    };

    tryPort(preferredPort);
  });
};

if (isProduction) {
  app.use((req, res, next) => {
    const forwardedProtocol = req.get('x-forwarded-proto')?.split(',')[0].trim();
    const requestIsHttps = forwardedProtocol === 'https' || req.secure;

    if (!requestIsHttps) {
      return res.redirect(308, `https://${req.get('host')}${req.originalUrl}`);
    }

    return next();
  });
}

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(auditSecurityEvents);

// Never expose unexpected database, filesystem, or runtime details to clients.
app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 500) {
      return originalJson({
        success: false,
        message: 'An unexpected server error occurred. Please try again.'
      });
    }
    return originalJson(body);
  };
  next();
});

// The public schedule-request router owns its own small JSON/multipart limits.
app.use(`${BASE_URI}/schedule-requests`, scheduleRequestsRouter);

// Middleware
app.use(express.json({ limit: '16mb' }));
app.use(validateRequestBody);
app.use(cookieParser());

// ============================================================
// ⚠️ IMPORTANT: PUBLIC ROUTES - NO AUTHENTICATION REQUIRED
// These routes MUST be defined BEFORE any auth middleware
// ============================================================

// 1. Health check - Public
app.get(`${BASE_URI}/health`, (req, res) => {
  const databaseReady = mongoose.connection.readyState === 1;
  res.status(databaseReady ? 200 : 503).json({
    status: databaseReady ? 'OK' : 'DEGRADED',
    database: databaseReady ? 'connected' : 'unavailable',
    message: databaseReady ? 'Server is running' : 'Database is temporarily unavailable'
  });
});

// 2. SCHEDULES - GET is PUBLIC (NO TOKEN NEEDED!)
app.use(`${BASE_URI}/schedules`, scheduleRoutes);

// 3. AUTH - Login, Register, and Password Reset are PUBLIC
app.use(`${BASE_URI}`, authRoutes);

// PROFILE - current user routes
const handleProfileGet = async (req, res) => {
  try {
    const user = await User.findById(req.user?._id).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const userObj = user.toObject();
    if (User.normalizeRole(user.role) === 'student') {
      const studentProfile = await StudentProfile.findOne({ studentId: user._id }).select('filename mimeType updatedAt').lean();
      userObj.profilePhoto = studentProfile ? `/profile/photo` : '';
      userObj.profilePhotoUpdatedAt = studentProfile?.updatedAt || null;
    }
    if (userObj.notifications === undefined) {
      userObj.notifications = true;
    }

    return res.json({
      success: true,
      user: userObj
    });
  } catch (error) {
    console.error('Profile fetch error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching profile'
    });
  }
};

const handleProfileUpdate = async (req, res) => {
  try {
    const { email, fullname, contactNumber, dateOfBirth, dob, department, yearLevel, sport, branchCampus, graduationYear, athleteStatus, currentPassword, newPassword, notifications } = req.body;
    const user = await User.findById(req.user?._id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (req.file && !['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(req.file.mimetype)) {
      return res.status(400).json({
        success: false,
        message: 'Profile photo must be a JPG, PNG, or GIF image.'
      });
    }

    if (email !== undefined) {
      const emailValue = String(email || '').trim().toLowerCase();
      if (!emailValue) {
        return res.status(400).json({
          success: false,
          message: 'Email is required.'
        });
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid email address.'
        });
      }

      const existingEmailUser = await User.findOne({
        email: emailValue,
        _id: { $ne: user._id }
      });

      if (existingEmailUser) {
        return res.status(400).json({
          success: false,
          message: 'Email already exists.'
        });
      }

      user.email = emailValue;
    }

    if (User.normalizeRole(user.role) === 'student') {
      const textFields = {
        fullname,
        contactNumber,
        dateOfBirth: dateOfBirth !== undefined ? dateOfBirth : dob,
        department,
        yearLevel,
        sport,
        branchCampus,
        graduationYear,
        athleteStatus
      };

      for (const [field, value] of Object.entries(textFields)) {
        if (value !== undefined) {
          const trimmedValue = String(value).trim();
          if (field === 'yearLevel' && trimmedValue && !['I', 'II', 'III', 'IV'].includes(trimmedValue)) {
            return res.status(400).json({ success: false, message: 'Please provide a valid year level.' });
          }
          if (field === 'branchCampus' && trimmedValue && !['Boac Main', 'Santa Cruz', 'Gasan', 'Torrijos'].includes(trimmedValue)) {
            return res.status(400).json({ success: false, message: 'Please provide a valid branch campus.' });
          }
          if (field === 'fullname' && !trimmedValue) {
            return res.status(400).json({ success: false, message: 'Full name is required.' });
          }
          if (field === 'contactNumber' && trimmedValue && !/^[0-9+()\-\s]{7,20}$/.test(trimmedValue)) {
            return res.status(400).json({ success: false, message: 'Please provide a valid contact number.' });
          }
          user[field] = trimmedValue;
        }
      }
    }

    let uploadedFileId = null;
    let previousProfile = null;
    if (req.file && User.normalizeRole(user.role) === 'student') {
      previousProfile = await StudentProfile.findOne({ studentId: user._id });
      uploadedFileId = await uploadProfilePhoto({
        buffer: req.file.buffer,
        filename: req.file.originalname,
        contentType: req.file.mimetype,
        studentId: user._id,
      });
    }

    if (newPassword !== undefined) {
      if (!currentPassword) {
        return res.status(400).json({
          success: false,
          message: 'Current password is required.'
        });
      }

      const passwordCheck = await verifyPassword(currentPassword, user.password);
      if (!passwordCheck.valid) {
        return res.status(401).json({
          success: false,
          message: 'Current password is incorrect.'
        });
      }

      const passwordValue = String(newPassword || '');
      if (!passwordValue) {
        return res.status(400).json({
          success: false,
          message: 'Password is required.'
        });
      }

      if (!isPasswordValid(passwordValue)) {
        return res.status(400).json({
          success: false,
          message: PASSWORD_POLICY_MESSAGE
        });
      }

      user.password = await hashPassword(passwordValue);
    }

    if (notifications !== undefined) {
      user.notifications = Boolean(notifications);
    }

    await user.save();

    if (uploadedFileId) {
      try {
        await StudentProfile.findOneAndUpdate(
          { studentId: user._id },
          {
            studentId: user._id,
            imageFileId: uploadedFileId,
            filename: req.file.originalname,
            mimeType: req.file.mimetype,
            storageReference: `gridfs://${uploadedFileId.toString()}`,
          },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        );
        if (previousProfile?.imageFileId && String(previousProfile.imageFileId) !== String(uploadedFileId)) {
          await deleteProfilePhoto(previousProfile.imageFileId);
        }
      } catch (photoError) {
        await deleteProfilePhoto(uploadedFileId).catch(() => {});
        throw photoError;
      }
    }

    const savedUser = await User.findById(user._id).select('-password');
    if (!savedUser) {
      return res.status(500).json({
        success: false,
        message: 'Profile update could not be confirmed in the database.'
      });
    }

    if (User.normalizeRole(savedUser.role) === 'student'
      && (savedUser.dateOfBirth !== user.dateOfBirth
        || savedUser.yearLevel !== user.yearLevel
        || savedUser.branchCampus !== user.branchCampus)) {
      return res.status(500).json({
        success: false,
        message: 'Profile update could not be confirmed in the database.'
      });
    }

    const userObj = savedUser.toObject();
    if (User.normalizeRole(savedUser.role) === 'student') {
      const studentProfile = await StudentProfile.findOne({ studentId: savedUser._id }).select('updatedAt').lean();
      userObj.profilePhoto = studentProfile ? `/profile/photo` : '';
      userObj.profilePhotoUpdatedAt = studentProfile?.updatedAt || null;
    }
    if (userObj.notifications === undefined) {
      userObj.notifications = true;
    }

    return res.json({
      success: true,
      message: 'Profile updated successfully',
      user: userObj
    });
  } catch (error) {
    console.error('Profile update error:', error);

    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({
        success: false,
        message: `${field} already exists.`
      });
    }

    return res.status(500).json({
      success: false,
      message: error.message || 'Server error while updating profile'
    });
  }
};

app.get('/profile', protect, apiRateLimiter, handleProfileGet);
app.get(`${BASE_URI}/profile`, protect, apiRateLimiter, handleProfileGet);
app.put('/profile', protect, apiRateLimiter, profilePhotoUpload.single('profilePhoto'), validateRequestBody, handleProfileUpdate);
app.put(`${BASE_URI}/profile`, protect, apiRateLimiter, profilePhotoUpload.single('profilePhoto'), validateRequestBody, handleProfileUpdate);

const sendStudentProfilePhoto = async (req, res, studentId) => {
  const profile = await StudentProfile.findOne({ studentId }).lean();
  if (!profile?.imageFileId) return res.status(404).json({ message: 'Profile photo not found' });
  res.setHeader('Content-Type', profile.mimeType);
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'no-store');
  try {
    await streamProfilePhoto(profile.imageFileId, res);
  } catch (error) {
    if (!res.headersSent) return res.status(404).json({ message: 'Profile photo not found' });
  }
};

app.get('/profile/photo', protect, apiRateLimiter, (req, res) => sendStudentProfilePhoto(req, res, req.user?._id));
app.get(`${BASE_URI}/profile/photo`, protect, apiRateLimiter, (req, res) => sendStudentProfilePhoto(req, res, req.user?._id));

// ============================================================
// 🔒 STUDENT ROUTES - Handle their own authentication
// Mount these BEFORE admin routes to prevent global protect
// ============================================================
app.use(BASE_URI + '/student', apiRateLimiter, studentRoutes);
app.use(BASE_URI + '/requirements', apiRateLimiter, requirementRoutes);

// ============================================================
// 🔒 PROTECTED ROUTES - Authentication REQUIRED
// All routes below this line require a valid token
// ============================================================

// Schedules - Protected routes (Admin only) - Create, Update, Delete
// GET routes are public and handled by the router above

// Schedule Requests - Protected routes (Admin only for viewing/managing)
// POST route is public and handled by the router above

// Other protected routes
// Mount screener routes before admin routes so specific screener paths
// are handled by the screener router (prevents accidental admin-only matches).
app.use(BASE_URI, protect, apiRateLimiter, screenerRoutes);
app.use(BASE_URI, protect, apiRateLimiter, adminRoutes);
app.use(BASE_URI, protect, apiRateLimiter, borrowingRoutes);
app.use(BASE_URI, protect, apiRateLimiter, equipmentRoutes);
app.use(BASE_URI, protect, apiRateLimiter, coachRoutes);
app.use(BASE_URI + '/users', protect, apiRateLimiter, userRoutes);

// ============================================================
// ERROR HANDLERS
// ============================================================

// 404 handler
app.use((req, res) => {
  console.log(`❌ 404: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ 
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found` 
  });
});

// Error handler
app.use((err, req, res, next) => {
  if (err.code === 'CORS_NOT_ALLOWED') {
    return res.status(403).json({
      success: false,
      message: 'Origin is not allowed'
    });
  }

  console.error('Unhandled request error:', err.message);
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      message: 'The uploaded file is too large.'
    });
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.message === 'Unsupported schedule request file') {
    return res.status(400).json({
      success: false,
      message: 'The uploaded request letter is invalid.'
    });
  }

  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      message: 'The request payload is too large. Please attach a file no larger than 10 MB.'
    });
  }

  if (err.message && /Only PDF, DOC, DOCX, JPG, PNG, and GIF/i.test(err.message)) {
    return res.status(400).json({
      success: false,
      message: 'Unsupported file type. Please upload a PDF, DOC, DOCX, JPG, PNG, or GIF file.'
    });
  }

  return res.status(500).json({
    success: false,
    message: 'Something went wrong while processing the request. Please try again.'
  });
});

// Start the standalone server only when this file is executed directly.
const startServer = async () => {
  try {
    console.log('🚀 Starting GymStat Web Application...\n');

    // Connect to MongoDB but do not crash the app if Atlas is temporarily unreachable.
    try {
      await connectDB();
    } catch (dbError) {
      console.error('⚠️ MongoDB connection failed at startup. The server will continue running in degraded mode.');
      console.error(dbError.message || dbError);
    }

    const preferredPort = Number(process.env.PORT || 4000);
    const PORT = await listenWithRetry(preferredPort);
    process.env.PORT = String(PORT);
    writePortFile(PORT);

    console.log('\n════════════════════════════════════════════════════');
    console.log(`✅ Server running on http://localhost:${PORT}`);
    console.log(`✅ API available at http://localhost:${PORT}${BASE_URI}`);
    console.log('════════════════════════════════════════════════════');
    console.log('\n📋 PUBLIC ROUTES (No Authentication Required):');
    console.log(`   POST   ${BASE_URI}/register - User registration`);
    console.log(`   POST   ${BASE_URI}/login - User login`);
    console.log(`   POST   ${BASE_URI}/schedule-requests - Submit schedule request`);
    console.log(`   GET    ${BASE_URI}/schedules - View schedules`);
    console.log(`   GET    ${BASE_URI}/health - Health check`);
    console.log('\n🔒 PROTECTED ROUTES (Authentication Required):');
    console.log('   All admin, coach, screener, and student routes');
    console.log('════════════════════════════════════════════════════\n');
  } catch (error) {
    console.error('\n❌ Failed to start server:', error.message);
    console.error('💡 Please check:');
    console.error('   1. MongoDB connection string in .env');
    console.error('   2. Internet connectivity');
    console.error('   3. MongoDB Atlas cluster status');
    console.error('   4. IP whitelist settings in MongoDB Atlas\n');
    process.exit(1);
  }
};

if (require.main === module) {
  startServer();
}

module.exports = app;