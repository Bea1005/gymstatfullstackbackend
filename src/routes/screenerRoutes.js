const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const User = require('../models/User');
const StudentAthlete = require('../models/StudentAthlete');
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

const toFileBuffer = (value) => {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (Buffer.isBuffer(value.buffer)) return value.buffer;
  if (value.buffer) return Buffer.from(value.buffer);
  if (value.type === 'Buffer' && Array.isArray(value.data)) return Buffer.from(value.data);
  return null;
};

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
    if (await denyOwnDepartmentAccess(req, res, submission)) return;

    const fileBuffer = toFileBuffer(submission.fileData);
    if (fileBuffer?.length) {
      const extension = path.extname(submission.fileName || '').toLowerCase();
      const expectedMime = allowedRequirementTypes.get(extension);
      const storedMime = String(submission.fileType || '').toLowerCase();
      if (!expectedMime || (storedMime && storedMime !== expectedMime) || fileBuffer.length > MAX_REQUIREMENT_FILE_SIZE) {
        return res.status(404).json({ success: false, message: 'Uploaded file is no longer available' });
      }

      const safeFileName = path.basename(submission.fileName || 'requirement').replace(/[\r\n"\\/]/g, '_');
      res.setHeader('Content-Type', expectedMime);
      res.setHeader('Content-Disposition', `inline; filename="${safeFileName}"`);
      res.setHeader('Content-Type', storedMime || expectedMime);
      return res.send(fileBuffer);
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

const getSavedSports = (sports) => Array.from(new Set(
  (Array.isArray(sports) ? sports : [])
    .filter((sport) => typeof sport === 'string')
    .map((sport) => sport.trim())
    .filter(Boolean)
));

const deriveOverallStatus = (requirements) => {
  const documents = Array.isArray(requirements?.documents) ? requirements.documents : [];
  const requiredKeys = ['med', 'psa', 'insurance', 'profile', 'consent'];
  const requiredCategoriesApproved = requiredKeys.every((key) => requirements?.[key]?.status === 'approved');
  const otherRequiredDocumentsApproved = documents
    .filter((document) => String(document?.requirementType || '').toLowerCase() !== 'cor')
    .every((document) => document?.status === 'approved');

  return requiredCategoriesApproved && otherRequiredDocumentsApproved
    ? 'Completed'
    : 'Incomplete';
};

const findStudentForSubmission = async (studentId) => {
  if (!studentId) return null;

  let student;
  try {
    let query = User.findById(studentId);
    if (query && typeof query.select === 'function') {
      query = query.select('department');
      if (typeof query.lean === 'function') query = query.lean();
    }
    student = await query;
  } catch (error) {
    if (!/Cast to ObjectId/i.test(error.message || '')) throw error;
  }

  if (!student) {
    let query = User.findOne({ id: String(studentId) });
    if (query && typeof query.select === 'function') {
      query = query.select('department');
      if (typeof query.lean === 'function') query = query.lean();
    }
    student = await query;
  }

  return student;
};

const denyOwnDepartmentAccess = async (req, res, submission) => {
  if (String(req.user?.role || '').toLowerCase() !== 'screener') return false;

  const screenerDepartment = String(req.user.department || '').trim();
  if (!screenerDepartment) {
    res.status(403).json({ success: false, message: 'Screener department is not configured.' });
    return true;
  }

  const student = await findStudentForSubmission(submission.studentId);
  const studentDepartment = String(student?.department || '').trim();
  if (!studentDepartment || studentDepartment === screenerDepartment) {
    res.status(403).json({ success: false, message: 'You are not authorized to access this requirement.' });
    return true;
  }

  return false;
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
    const isScreener = String(req.user?.role || '').toLowerCase() === 'screener';
    const screenerDepartment = String(req.user?.department || '').trim();
    if (isScreener && !screenerDepartment) {
      return res.status(403).json({ success: false, message: 'Screener department is not configured.' });
    }

    // Get all students
    const participationType = normalizeParticipationType(req.query.participationType);
    const studentQuery = { role: 'student' };
    if (isScreener) {
      studentQuery.department = {
        $exists: true,
        $nin: ['', null, screenerDepartment]
      };
    }
    const studentsFromDb = participationType === 'STRASUC' && !isScreener
      ? []
      : await User.find(studentQuery)
      .select('fullname username department createdAt')
      .sort({ createdAt: -1 })
      .lean();
    const visibleStudents = isScreener
      ? studentsFromDb.filter((student) => String(student.department || '').trim()
        && String(student.department).trim() !== screenerDepartment)
      : studentsFromDb;

    const athleteProfiles = visibleStudents.length
      ? await StudentAthlete.find({ userId: { $in: visibleStudents.map((student) => student._id) } })
        .select('userId sports yearLevel')
        .lean()
      : [];
    const athleteProfilesByUserId = new Map(
      athleteProfiles.map((profile) => [String(profile.userId), profile])
    );
    
    console.log(`👥 Found ${studentsFromDb.length} students in database`);

    // Get all student requirements submissions
    const RequirementModel = getStudentRequirementModel(participationType);
    const participationFilter = participationType === 'Intrams'
      ? { $or: [{ participationType: 'Intrams' }, { participationType: { $exists: false } }] }
      : { participationType: 'STRASUC' };
    const submissionFilter = isScreener
      ? {
          $and: [
            participationFilter,
            { studentId: { $in: visibleStudents.map((student) => student._id) } }
          ]
        }
      : participationFilter;
    let submissionsQuery = RequirementModel.find(submissionFilter)
      .select('studentId requirementType participationType customRequirementLabel fileName fileType fileSize filePath status resubmitted uploadDate createdAt remarks')
      .sort({ uploadDate: -1, _id: -1 });
    if (!isScreener || participationType === 'STRASUC') {
      submissionsQuery = submissionsQuery.populate('studentId', 'fullname department yearLevel sport sports assignedSports id username');
    }
    const submissions = await submissionsQuery.lean();

    console.log(`📄 Found ${submissions.length} requirement submissions`);

    // Create a map of students
    const studentsById = new Map();
    const studentRecordsById = new Map();

    // Add all students from the users collection
    visibleStudents.forEach((student) => {
      const studentId = student._id.toString();
      const athleteProfile = athleteProfilesByUserId.get(studentId);
      const studentSports = getSavedSports(athleteProfile?.sports);

      studentRecordsById.set(studentId, student);
      studentsById.set(studentId, {
        id: studentId,
        name: student.fullname || student.username || 'Unknown Student',
        department: student.department || 'Not specified',
        sport: studentSports[0] || 'Not specified',
        sports: [...new Set(studentSports)],
        yearLevel: athleteProfile?.yearLevel || '',
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
      const lookupId = submission.studentId && submission.studentId.toString
        ? submission.studentId.toString()
        : submission.studentId;
      if ((!student || !student.fullname) && studentRecordsById.has(String(lookupId))) {
        student = studentRecordsById.get(String(lookupId));
      }

      // If populate didn't work, try to find the student manually
      if (!student || !student.fullname) {
        try {
          const found = await User.findOne({ $or: [{ _id: lookupId }, { id: lookupId }] })
            .select('fullname username department id')
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
          yearLevel: '',
          id: fallbackId
        };
      }

      const studentDepartment = String(student.department || '').trim();
      if (isScreener && (!studentDepartment || studentDepartment === screenerDepartment)) continue;

      const studentId = (student._id || student.id).toString();
      
      // Normalize the requirement type
      let normalizedKey = submission.requirementType;
      if (normalizedKey === 'medical') normalizedKey = 'med';

      // Create a new student entry if it doesn't exist
      if (!studentsById.has(studentId)) {
        const athleteProfile = athleteProfilesByUserId.get(studentId);
        const studentSports = getSavedSports(athleteProfile?.sports);

        studentsById.set(studentId, {
          id: studentId,
          name: student.fullname || student.username || 'Unknown Student',
          department: student.department || 'Not specified',
          sport: studentSports[0] || 'Not specified',
          sports: [...new Set(studentSports)],
          yearLevel: athleteProfile?.yearLevel || '',
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
      const hasUpload = Number(submission.fileSize) > 0 || Boolean(storedFilePath && fs.existsSync(storedFilePath));
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
      message: 'An unexpected server error occurred. Please try again.'
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
    if (await denyOwnDepartmentAccess(req, res, submission)) return;

    submission.resubmitted = false;
    await submission.save();

    res.json({ success: true, message: 'Requirement resubmission marked as viewed', data: submission });
  } catch (error) {
    console.error('❌ Mark resubmission viewed error:', error);
    res.status(500).json({ success: false, message: 'An unexpected server error occurred. Please try again.' });
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

    if (await denyOwnDepartmentAccess(req, res, submission)) return;

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
      submission.notificationReadAt = null;
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
    submission.notificationReadAt = normalizedStatus === 'approved' ? null : submission.notificationReadAt;

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
      message: 'An unexpected server error occurred. Please try again.'
    });
  }
});

module.exports = router;