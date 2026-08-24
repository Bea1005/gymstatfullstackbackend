const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
  createSchedule,
  getSchedules,
  getScheduleById,
  updateSchedule,
  deleteSchedule,
  getSchedulesByDateRange
} = require('../controllers/scheduleController');

// ============================================
// PUBLIC ROUTES - Anyone can view schedules
// ============================================

// Get all schedules (Public - for viewing calendar)
router.get('/', getSchedules);

// Get schedules by date range (Public - for calendar view)
router.get('/date-range', getSchedulesByDateRange);

// Get single schedule (Public - for viewing details)
router.get('/:id', getScheduleById);

// ============================================
// PROTECTED ROUTES (Admin only)
// ============================================

// Create schedule (Admin only)
router.post('/', protect, authorize('admin'), createSchedule);

// Update schedule (Admin only)
router.put('/:id', protect, authorize('admin'), updateSchedule);

// Delete schedule (Admin only)
router.delete('/:id', protect, authorize('admin'), deleteSchedule);

module.exports = router;