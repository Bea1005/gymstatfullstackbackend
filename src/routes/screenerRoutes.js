const express = require('express');
const path = require('path');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const User = require('../models/User');
const StudentRequirement = require('../models/StudentRequirement');

const requirementKeyLabels = {
  medical: 'Medical Certificate',
  cor: 'Certificate of Registration',
  psa: 'PSA',
  insurance: 'Insurance',
  profile: 'Student Profile',
  consent: 'Parent Consent'
};

const normalizeRequirementStatus = (status) => {
  if (!status) return 'pending';
  const lower = String(status).toLowerCase();
  if (lower === 'approved') return 'approved';
  if (lower === 'rejected') return 'rejected';
  return 'pending';
};

const deriveOverallStatus = (requirements) => {
  const entries = Object.values(requirements || {});
  if (entries.length === 0) return 'No Documents Attached';

  const hasRejected = entries.some((item) => item && item.status === 'rejected');
  if (hasRejected) return 'Incomplete';

  const allApproved = entries.every((item) => item && item.status === 'approved');
  if (allApproved) return 'Completed';

  const hasUploads = entries.some((item) => item && item.hasUpload);
  if (hasUploads) return 'Pending';

  return 'No Documents Attached';
};

// @desc    Get all student requirement submissions for the screener portal
// @route   GET /api/v1/screener/requirements
// @access  Private/Screener
router.get('/screener/requirements', protect, authorize('screener', 'admin'), async (req, res) => {
  console.log('🔍 Screener requirements request:', { 
    path: req.originalUrl, 
    method: req.method, 
    userRole: req.user?.role,
    userId: req.user?._id
  });
  
  try {
    // Get all students
    const studentsFromDb = await User.find({ role: 'student' })
      .select('-password')
      .sort({ createdAt: -1 })
      .lean();
    
    console.log(`👥 Found ${studentsFromDb.length} students in database`);

    // Get all student requirements submissions
    const submissions = await StudentRequirement.find({})
      .populate('studentId', 'fullname department sport id username')
      .sort({ uploadDate: -1 })
      .lean();

    console.log(`📄 Found ${submissions.length} requirement submissions`);

    // Create a map of students
    const studentsById = new Map();

    // Add all students from the users collection
    studentsFromDb.forEach((student) => {
      const studentId = student._id.toString();
      studentsById.set(studentId, {
        id: studentId,
        name: student.fullname || student.username || 'Unknown Student',
        department: student.department || 'Not specified',
        sport: student.sport || 'Not specified',
        requirements: {
          cor: null,
          med: null,
          psa: null,
          insurance: null,
          profile: null,
          consent: null
        }
      });
    });

    // Process all submissions
    for (const submission of submissions) {
      let student = submission.studentId;

      // If populate didn't work, try to find the student manually
      if (!student || !student.fullname) {
        const lookupId = submission.studentId && submission.studentId.toString ? submission.studentId.toString() : submission.studentId;
        try {
          const found = await User.findOne({ $or: [{ _id: lookupId }, { id: lookupId }] })
            .select('-password')
            .lean();
          if (found) student = found;
        } catch (err) {
          console.log('Could not find student for submission:', lookupId);
        }
      }

      // If still no student, create a placeholder
      if (!student) {
        const fallbackId = submission.studentId && submission.studentId.toString ? submission.studentId.toString() : (submission.studentId || 'unknown');
        student = {
          _id: fallbackId,
          fullname: submission.fileName ? (submission.fileName.split('_')[0] || 'Unknown Student') : 'Unknown Student',
          department: 'Not specified',
          sport: submission.sport || 'Not specified',
          id: fallbackId
        };
      }

      const studentId = (student._id || student.id).toString();
      
      // Normalize the requirement type
      let normalizedKey = submission.requirementType;
      if (normalizedKey === 'medical') normalizedKey = 'med';
      
      // Create a new student entry if it doesn't exist
      if (!studentsById.has(studentId)) {
        studentsById.set(studentId, {
          id: studentId,
          name: student.fullname || student.username || 'Unknown Student',
          department: student.department || 'Not specified',
          sport: student.sport || 'Not specified',
          requirements: {
            cor: null,
            med: null,
            psa: null,
            insurance: null,
            profile: null,
            consent: null
          }
        });
      }

      // Add the requirement to the student's requirements
      const studentEntry = studentsById.get(studentId);
      studentEntry.requirements[normalizedKey] = {
        submissionId: submission._id,
        requirementType: submission.requirementType,
        status: normalizeRequirementStatus(submission.status),
        resubmitted: submission.resubmitted || false,
        label: requirementKeyLabels[submission.requirementType] || submission.requirementType,
        fileName: submission.fileName || 'Uploaded file',
        fileType: submission.fileType || '',
        fileUrl: submission.filePath ? `/uploads/requirements/${path.basename(submission.filePath)}` : '',
        uploadedAt: submission.uploadDate || submission.createdAt,
        remarks: submission.remarks || '',
        hasUpload: true
      };
    }

    // Convert map to array and add overall status
    const students = Array.from(studentsById.values()).map((student) => ({
      ...student,
      overallStatus: deriveOverallStatus(student.requirements)
    }));

    console.log(`✅ Returning ${students.length} students with requirements`);

    res.json({
      success: true,
      count: students.length,
      data: students
    });
  } catch (error) {
    console.error('❌ Get screener requirements error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error: ' + error.message 
    });
  }
});

// @desc    Mark a resubmitted requirement as viewed by the screener
// @route   PUT /api/v1/screener/requirements/:id/viewed
// @access  Private/Screener
router.put('/screener/requirements/:id/viewed', protect, authorize('screener', 'admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const submission = await StudentRequirement.findById(id);
    if (!submission) {
      return res.status(404).json({ success: false, message: 'Submission not found' });
    }

    submission.resubmitted = false;
    await submission.save();

    res.json({ success: true, message: 'Requirement resubmission marked as viewed', data: submission });
  } catch (error) {
    console.error('❌ Mark resubmission viewed error:', error);
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

// @desc    Review a student requirement submission
// @route   PUT /api/v1/screener/requirements/:id/review
// @access  Private/Screener
router.put('/screener/requirements/:id/review', protect, authorize('screener', 'admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, feedback = '', remarks = '' } = req.body;
    const normalizedStatus = String(status || '').toLowerCase();

    if (!['approved', 'rejected', 'pending'].includes(normalizedStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid review status. Must be: approved, rejected, or pending'
      });
    }

    const submission = await StudentRequirement.findById(id);
    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Submission not found'
      });
    }

    if (normalizedStatus === 'rejected') {
      submission.status = 'rejected';
      submission.resubmitted = false;
      submission.remarks = [feedback, remarks].filter(Boolean).join(' — ');
      submission.reviewedAt = new Date();
      submission.reviewedBy = req.user?._id || req.user?.id || null;
      submission.approvalDate = null;
      submission.approvedBy = null;
      await submission.save();

      console.log(`✅ Requirement ${id} rejected and kept for student re-upload`);
      return res.json({
        success: true,
        message: 'Requirement rejected and kept for re-upload',
        data: submission
      });
    }

    submission.status = normalizedStatus;
    submission.remarks = [feedback, remarks].filter(Boolean).join(' — ');

    if (normalizedStatus === 'approved') {
      submission.approvedBy = req.user._id || req.user.id;
      submission.approvalDate = new Date();
    }

    submission.resubmitted = false;
    await submission.save();

    console.log(`✅ Requirement ${id} reviewed: ${normalizedStatus}`);

    res.json({
      success: true,
      message: `Requirement ${normalizedStatus} successfully`,
      data: submission
    });
  } catch (error) {
    console.error('❌ Review requirement error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error: ' + error.message
    });
  }
});

module.exports = router;