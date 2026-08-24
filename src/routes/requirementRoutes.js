const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const upload = require('../config/multer');
const {
  createRequirement,
  publishRequirement,
  getAllRequirements,
  getPublishedRequirements,
  getRequirementById,
  updateRequirement,
  deleteRequirement,
  submitRequirement,
  getMySubmissions,
  getAllSubmissions,
  reviewSubmission,
  downloadRequirement
} = require('../controllers/requirementController');

// ============================================
// STUDENT ROUTES - Protected (Student role)
// ============================================

// IMPORTANT: Specific routes MUST come before generic :id routes!

// Get all published requirements (Student view)
router.get('/published', protect, authorize('student'), getPublishedRequirements);

// Get my submissions (BEFORE :id route)
router.get('/my/submissions', protect, authorize('student'), getMySubmissions);

// Download a published requirement (BEFORE :id route)
router.get('/:id/download', protect, authorize('student', 'admin'), downloadRequirement);

// Submit a requirement (BEFORE :id route for other methods)
router.post('/:requirementId/submit', protect, authorize('student'), submitRequirement);

// Get single requirement details (AFTER specific routes)
router.get('/:id', protect, getRequirementById);

// ============================================
// ADMIN ROUTES - Protected (Admin role)
// ============================================

// Get all submissions (Admin view) - MUST come before /:id route
router.get('/admin/submissions', protect, authorize('admin'), getAllSubmissions);

// Get all requirements (Admin view - includes drafts)
router.get('/', protect, authorize('admin'), getAllRequirements);

// Create new requirement (with file upload)
router.post('/', protect, authorize('admin'), upload.single('file'), createRequirement);

// Publish requirement (makes it visible to students)
router.post('/:id/publish', protect, authorize('admin'), publishRequirement);

// Update requirement
router.put('/:id', protect, authorize('admin'), updateRequirement);

// Delete requirement
router.delete('/:id', protect, authorize('admin'), deleteRequirement);

// Review a submission (approve/reject)
router.put('/submissions/:id/review', protect, authorize('admin'), reviewSubmission);

module.exports = router;
