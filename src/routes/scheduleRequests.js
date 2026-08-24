const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
  createScheduleRequest,
  getScheduleRequests,
  getScheduleRequestById,
  updateScheduleRequest,
  deleteScheduleRequest,
  getRequestsByStatus
} = require('../controllers/scheduleRequestController');

// ============================================
// PUBLIC ROUTE - NO AUTHENTICATION REQUIRED
// ✅ Anyone can submit a schedule request
// ============================================
router.post('/', createScheduleRequest);

// Debug route (optional - can be removed in production)
router.get('/debug/test', (req, res) => {
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

// Get single schedule request (Admin only)
router.get('/:id', protect, authorize('admin'), getScheduleRequestById);

// Update schedule request (Admin only - for approving/rejecting)
router.put('/:id', protect, authorize('admin'), updateScheduleRequest);

// Delete schedule request (Admin only)
router.delete('/:id', protect, authorize('admin'), deleteScheduleRequest);

module.exports = router;