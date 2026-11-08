const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { normalizePhoneNumber } = require('../config/sms');
const { getScheduleClientType, getScheduleAccountType } = require('../utils/scheduleClientType');
const requireCalendarRequester = (req, res, next) => {
  const email = String(req.user?.email || '').trim().toLowerCase();
  const clientType = getScheduleClientType(email);
  if (!req.user || req.user.emailVerified === false || !clientType) {
    return res.status(403).json({
      success: false,
      message: 'A verified, authenticated account is required to request a schedule.'
    });
  }
  if (!String(req.user.fullname || '').trim() || !normalizePhoneNumber(req.user.contactNumber)) {
    return res.status(403).json({
      success: false,
      message: 'Complete your profile before requesting a schedule.'
    });
  }
  req.user.accountType = getScheduleAccountType(email);
  return next();
};
const { scheduleRequestRateLimiter } = require('../config/rateLimit');
const { scheduleRequestUpload } = require('../config/multer');
const { validateScheduleRequest } = require('../middleware/scheduleRequestValidation');
const {
  createScheduleRequest,
  getPublicCalendarScheduleRequests,
  getScheduleRequests,
  getScheduleRequestById,
  downloadScheduleRequestFile,
  updateScheduleRequest,
  deleteScheduleRequest,
  getRequestsByStatus
} = require('../controllers/scheduleRequestController');

// Schedule requests are only accepted from an authenticated account.
router.post(
  '/',
  scheduleRequestRateLimiter,
  express.json({ limit: process.env.SCHEDULE_REQUEST_JSON_LIMIT || '64kb' }),
  protect,
  requireCalendarRequester,
  scheduleRequestUpload.single('file'),
  validateScheduleRequest,
  createScheduleRequest
);

router.get('/public-calendar', getPublicCalendarScheduleRequests);

// Diagnostic route requires authentication.
router.get('/debug/test', protect, (req, res) => {
  res.json({
    message: 'Schedule requests API is working with MongoDB!',
    publicRoute: 'POST / requires an authenticated calendar requester.',
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