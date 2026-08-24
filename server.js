require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const connectDB = require('./src/config/db');
const User = require('./src/models/User');
const { protect, authorize } = require('./src/middleware/auth');
const { forgotPassword } = require('./src/controllers/authControllers');

console.log('🔐 Environment Configuration:');
console.log(`   PORT: ${process.env.PORT || 4000}`);
console.log(`   BASE_URI: ${process.env.BASE_URI || '/api/v1'}`);

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

const app = express();
const rawBaseUri = process.env.BASE_URI || '/api/v1';
const BASE_URI = rawBaseUri.replace(/\/+$|^\s+|\s+$/g, '') || '/api/v1';
const PORT_FILE = path.join(__dirname, '.port');

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

// CORS
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
  process.env.FRONTEND_URL || 'https://gymstatwebbased.vercel.app',
];

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));
app.options('*', cors({ origin: allowedOrigins, credentials: true }));

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use('/uploads', express.static('uploads'));

// ============================================================
// ⚠️ IMPORTANT: PUBLIC ROUTES - NO AUTHENTICATION REQUIRED
// These routes MUST be defined BEFORE any auth middleware
// ============================================================

// 1. Health check - Public
app.get(`${BASE_URI}/health`, (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// 2. SCHEDULE REQUESTS - POST is PUBLIC (NO TOKEN NEEDED!)
// ✅ Public can submit schedule requests without authentication
app.use(`${BASE_URI}/schedule-requests`, scheduleRequestsRouter);

// 3. SCHEDULES - GET is PUBLIC (NO TOKEN NEEDED!)
app.use(`${BASE_URI}/schedules`, scheduleRoutes);

// 4. AUTH - Login, Register, and Forgot Password are PUBLIC
app.post('/forgot-password', forgotPassword);
app.post(`${BASE_URI}/forgot-password`, forgotPassword);
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
    const { username, email, fullname, contactNumber, dateOfBirth, dob, department, yearLevel, sport, branchCampus, graduationYear, athleteStatus, newPassword, notifications } = req.body;
    const user = await User.findById(req.user?._id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (req.file && !['image/jpeg', 'image/png', 'image/gif'].includes(req.file.mimetype)) {
      fs.unlink(req.file.path, () => {});
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
      if (username !== undefined) {
        const usernameValue = String(username || '').trim();
        if (!usernameValue) {
          return res.status(400).json({ success: false, message: 'Username is required.' });
        }

        if (!/^[A-Za-z0-9._-]{3,30}$/.test(usernameValue)) {
          return res.status(400).json({
            success: false,
            message: 'Username must be 3-30 characters and contain only letters, numbers, periods, underscores, or hyphens.'
          });
        }

        const existingUsernameUser = await User.findOne({
          username: usernameValue,
          _id: { $ne: user._id }
        });

        if (existingUsernameUser) {
          return res.status(400).json({ success: false, message: 'Username already exists.' });
        }

        user.username = usernameValue;
      }

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

    if (req.file && User.normalizeRole(user.role) === 'student') {
      user.profilePhoto = `/uploads/requirements/${req.file.filename}`;
    }

    if (newPassword !== undefined) {
      const passwordValue = String(newPassword || '');
      if (!passwordValue) {
        return res.status(400).json({
          success: false,
          message: 'Password is required.'
        });
      }

      if (passwordValue.length < 8) {
        return res.status(400).json({
          success: false,
          message: 'Password must be at least 8 characters long.'
        });
      }

      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(passwordValue, salt);
    }

    if (notifications !== undefined) {
      user.notifications = Boolean(notifications);
    }

    await user.save();

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

app.get('/profile', protect, handleProfileGet);
app.get(`${BASE_URI}/profile`, protect, handleProfileGet);
app.put('/profile', protect, upload.single('profilePhoto'), handleProfileUpdate);
app.put(`${BASE_URI}/profile`, protect, upload.single('profilePhoto'), handleProfileUpdate);

// ============================================================
// 🔒 STUDENT ROUTES - Handle their own authentication
// Mount these BEFORE admin routes to prevent global protect
// ============================================================
app.use(BASE_URI + '/student', studentRoutes);
app.use(BASE_URI + '/requirements', requirementRoutes);

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
app.use(BASE_URI, protect, screenerRoutes);
app.use(BASE_URI, protect, adminRoutes);
app.use(BASE_URI, protect, borrowingRoutes);
app.use(BASE_URI, protect, equipmentRoutes);
app.use(BASE_URI, protect, coachRoutes);
app.use(BASE_URI + '/users', protect, userRoutes);

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
  console.error('Error:', err.message);
  res.status(500).json({ 
    success: false,
    message: err.message 
  });
});

// Start server
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

startServer();