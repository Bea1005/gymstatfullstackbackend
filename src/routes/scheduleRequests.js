const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { scheduleRequestRateLimiter } = require('../config/rateLimit');
const { scheduleRequestUpload } = require('../config/multer');
const { validateScheduleRequest } = require('../middleware/scheduleRequestValidation');
const {
  createScheduleRequest,
  getScheduleRequests,
  getScheduleRequestById,
  downloadScheduleRequestFile,
  updateScheduleRequest,
  deleteScheduleRequest,
  getRequestsByStatus
} = require('../controllers/scheduleRequestController');

// ============================================
// PUBLIC ROUTE - NO AUTHENTICATION REQUIRED
// ✅ Anyone can submit a schedule request
// ============================================
router.post(
  '/',
  scheduleRequestRateLimiter,
  express.json({ limit: process.env.SCHEDULE_REQUEST_JSON_LIMIT || '64kb' }),
  scheduleRequestUpload.single('file'),
  validateScheduleRequest,
  createScheduleRequest
);

// Diagnostic route requires authentication.
router.get('/debug/test', protect, (req, res) => {
  res.json({
    message: 'Schedule requests API is working with MongoDB!',
    publicRoute: 'POST / is public - No token needed!',
    database: 'MongoDB connected'
  });
});

// ============================================
// PROTECTED ROUTES - ADMIN ONLY
// ============================================

// Get all schedule requests (Admin only)
router.get('/', protect, authorize('admin'), getScheduleRequests);

// Get schedule requests by status (Admin only)
router.get('/status/:status', protect, authorize('admin'), getRequestsByStatus);

// Schedule request files are private and admin-only.
router.get('/:id/file', protect, authorize('admin'), downloadScheduleRequestFile);

// Get single schedule request (Admin only)
router.get('/:id', protect, authorize('admin'), getScheduleRequestById);

// Update schedule request (Admin only - for approving/rejecting)
router.put('/:id', protect, authorize('admin'), updateScheduleRequest);

// Delete schedule request (Admin only)
router.delete('/:id', protect, authorize('admin'), deleteScheduleRequest);

module.exports = router;