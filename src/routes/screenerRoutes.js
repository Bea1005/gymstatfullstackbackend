const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const User = require('../models/User');
const {
  getStudentRequirementModel,
  getAllStudentRequirementModels,
  normalizeParticipationType
} = require('../models/studentRequirementCollections');

const backendRoot = path.resolve(__dirname, '../..');
const uploadRoot = path.join(backendRoot, 'uploads');
const requirementUploadRoot = path.resolve(uploadRoot, 'requirements');
const MAX_REQUIREMENT_FILE_SIZE = 5 * 1024 * 1024;
const allowedRequirementTypes = new Map([
  ['.pdf', 'application/pdf'],
  ['.doc', 'application/msword'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp']
]);

const resolveStoredFilePath = (storedPath) => {
  if (!storedPath) return '';
  const normalizedPath = String(storedPath).replace(/[\\/]+/g, path.sep);
  const candidates = path.isAbsolute(normalizedPath)
    ? [normalizedPath]
    : [
        path.resolve(backendRoot, normalizedPath),
        path.resolve(backendRoot, '..', normalizedPath),
        path.resolve(uploadRoot, normalizedPath.replace(/^uploads[\\/]/i, ''))
      ];

  const safeCandidate = candidates.find((candidate) => {
    const resolvedCandidate = path.resolve(candidate);
    return resolvedCandidate.startsWith(`${requirementUploadRoot}${path.sep}`)
      && fs.existsSync(resolvedCandidate);
  });

  return safeCandidate || '';
};

const serveScreenerRequirementFile = async (req, res) => {
  try {
    if (!/^[a-f\d]{24}$/i.test(req.params.id)) {
      return res.status(404).json({ success: false, message: 'Requirement not found' });
    }

    const RequirementModel = getStudentRequirementModel(req.query.participationType);
    const submission = await RequirementModel.findById(req.params.id).select('+fileData').lean();

    if (!submission) {
      return res.status(404).json({ success: false, message: 'Requirement not found' });
    }

    if (submission.fileData?.length) {
      const extension = path.extname(submission.fileName || '').toLowerCase();
      const expectedMime = allowedRequirementTypes.get(extension);
      if (!expectedMime || submission.fileType !== expectedMime || submission.fileData.length > MAX_REQUIREMENT_FILE_SIZE) {
        return res.status(404).json({ success: false, message: 'Uploaded file is no longer available' });
      }

      const safeFileName = path.basename(submission.fileName || 'requirement').replace(/[\r\n"\\/]/g, '_');
      res.setHeader('Content-Type', expectedMime);
      res.setHeader('Content-Disposition', `inline; filename="${safeFileName}"`);
      return res.send(submission.fileData);
    }

    const storedPath = submission.filePath || '';
    const filePath = resolveStoredFilePath(storedPath);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'Uploaded file is no longer available' });
    }

    const extension = path.extname(submission.fileName || filePath).toLowerCase();
    const expectedMime = allowedRequirementTypes.get(extension);
    const fileStats = fs.statSync(filePath);
    if (!expectedMime || submission.fileType !== expectedMime || fileStats.size > MAX_REQUIREMENT_FILE_SIZE) {
      return res.status(404).json({ success: false, message: 'Uploaded file is no longer available' });
    }

    const safeFileName = path.basename(submission.fileName || path.basename(filePath)).replace(/[\r\n"\\/]/g, '_');
    res.setHeader('Content-Type', expectedMime);
    res.setHeader('Content-Disposition', `inline; filename="${safeFileName}"`);
    return res.sendFile(filePath);
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Unable to download uploaded file' });
  }
};

router.get('/screener/requirements/:id/download', protect, authorize('screener', 'admin'), serveScreenerRequirementFile);
router.get('/screener/requirements/:id/preview', protect, authorize('screener', 'admin'), serveScreenerRequirementFile);

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
  const entries = Object.entries(requirements || {})
    .filter(([key]) => key !== 'documents')
    .map(([, value]) => value);
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
    const participationType = normalizeParticipationType(req.query.participationType);
    const studentsFromDb = participationType === 'STRASUC'
      ? []
      : await User.find({ role: 'student' })
      .select('-password')
      .sort({ createdAt: -1 })
      .lean();
    
    console.log(`👥 Found ${studentsFromDb.length} students in database`);

    // Get all student requirements submissions
    const RequirementModel = getStudentRequirementModel(participationType);
    const participationFilter = participationType === 'Intrams'
      ? { $or: [{ participationType: 'Intrams' }, { participationType: { $exists: false } }] }
      : { participationType: 'STRASUC' };
    const submissions = await RequirementModel.find(participationFilter)
      .select('+fileData')
      .populate('studentId', 'fullname department sport id username')
      .sort({ uploadDate: -1, _id: -1 })
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
            consent: null,
            documents: []
        }
      });
    });

    // Keep every stored record once. The detail page renders one card per record.
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
            consent: null,
            documents: []
          }
        });
      }

      // Add the requirement to the student's requirements
      const studentEntry = studentsById.get(studentId);
      const storedFilePath = resolveStoredFilePath(submission.filePath);
      const hasUpload = Boolean(submission.fileData?.length || (storedFilePath && fs.existsSync(storedFilePath)));
      const document = {
        submissionId: submission._id,
        requirementType: submission.requirementType,
        status: normalizeRequirementStatus(submission.status),
        resubmitted: submission.resubmitted || false,
        label: submission.customRequirementLabel || requirementKeyLabels[submission.requirementType] || submission.requirementType,
        fileName: submission.fileName || 'Uploaded file',
        fileType: submission.fileType || '',
        fileUrl: `/screener/requirements/${submission._id}/preview?participationType=${encodeURIComponent(submission.participationType || 'Intrams')}`,
        uploadedAt: submission.uploadDate || submission.createdAt,
        remarks: submission.remarks || '',
        hasUpload,
        participationType: submission.participationType || 'Intrams'
      };
      studentEntry.requirements.documents.push(document);

      const currentEntry = studentEntry.requirements[normalizedKey];
      if (!currentEntry || new Date(document.uploadedAt || 0) > new Date(currentEntry.uploadedAt || 0)) {
        studentEntry.requirements[normalizedKey] = document;
      }
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
    const RequirementModel = getStudentRequirementModel(req.body?.participationType);
    const submission = await RequirementModel.findById(id);
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
    const { status, feedback = '', remarks = '', studentId, participationType } = req.body;
    const normalizedStatus = String(status || '').toLowerCase();

    if (!['approved', 'rejected', 'pending'].includes(normalizedStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid review status. Must be: approved, rejected, or pending'
      });
    }

    if (normalizedStatus === 'rejected' && !studentId) {
      return res.status(400).json({
        success: false,
        message: 'Student context is required'
      });
    }

    const RequirementModel = getStudentRequirementModel(participationType);
    const submission = await RequirementModel.findById(id);
    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Submission not found'
      });
    }

    if (studentId && String(submission.studentId) !== String(studentId)) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to modify this requirement'
      });
    }

    if (normalizedStatus === 'rejected') {
      submission.status = 'rejected';
      submission.remarks = [feedback, remarks].filter(Boolean).join(' — ');
      submission.reviewedAt = new Date();
      submission.reviewedBy = req.user?._id || req.user?.id || null;
      submission.resubmitted = false;
      await submission.save();

      console.log(`✅ Requirement ${id} rejected and retained for student re-upload`);
      return res.json({
        success: true,
        message: 'Requirement rejected and retained for re-upload',
        data: {
          id: submission._id,
          status: submission.status,
          remarks: submission.remarks,
          reviewedAt: submission.reviewedAt
        }
      });
    }

    submission.status = normalizedStatus;
    submission.remarks = [feedback, remarks].filter(Boolean).join(' — ');

    if (normalizedStatus === 'approved') {
      submission.approvedBy = req.user?._id || req.user?.id || null;
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