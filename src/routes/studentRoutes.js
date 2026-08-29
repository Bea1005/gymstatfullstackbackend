const express = require('express');
const { protect, authorize } = require('../middleware/auth');
const upload = require('../config/multer');
const {
  uploadRequirement,
  getStudentRequirements,
  importPreviousYearRequirements,
  downloadRequirement,
  deleteRequirement,
  getAnnouncements,
  getStudentStats
} = require('../controllers/studentController');

const router = express.Router();

// Public routes - no authentication required
router.get('/announcements', getAnnouncements);

// Protected routes - require authentication below this
router.use(protect);

// Student-specific routes - all protected
router.post('/requirements', upload.single('file'), uploadRequirement);
router.post('/requirements/import-previous-year', importPreviousYearRequirements);
router.get('/requirements', getStudentRequirements);
router.get('/requirements/:id/download', downloadRequirement);
router.delete('/requirements/:id', deleteRequirement);
router.get('/stats', getStudentStats);

module.exports = router;
