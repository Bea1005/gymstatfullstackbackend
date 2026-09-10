const express = require('express');
const { protect, authorize } = require('../middleware/auth');
const upload = require('../config/multer');
const { validateRequestBody } = require('../middleware/requestValidation');
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

// Protected routes - require student authentication below this
router.use(protect);
router.use(authorize('student'));

// Student-specific routes - all protected
router.post('/requirements', upload.single('file'), validateRequestBody, uploadRequirement);
router.post('/requirements/import-previous-year', importPreviousYearRequirements);
router.get('/requirements', getStudentRequirements);
router.get('/requirements/:id/download', downloadRequirement);
router.delete('/requirements/:id', deleteRequirement);
router.get('/stats', getStudentStats);

module.exports = router;
