const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const User = require('../models/User');
const StudentAthlete = require('../models/StudentAthlete');
const {
  getStudentRequirementModel,
  normalizeParticipationType
} = require('../models/studentRequirementCollections');
const { getStudentSports, splitRequirementSports } = require('../utils/requirementSports');

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
    const role = String(req.user?.role || '').toLowerCase();
    if (!['admin', 'coach', 'screener'].includes(role)) {
      return res.status(403).json({ success: false, message: 'You are not authorized to access this requirement.' });
    }

    if (!/^[a-f\d]{24}$/i.test(req.params.id)) {
      return res.status(404).json({ success: false, message: 'Requirement not found' });
    }

    const RequirementModel = getStudentRequirementModel(req.query.participationType);
    const submission = await RequirementModel.findById(req.params.id)
      .select('+fileData +files.fileData')
      .lean();

    if (!submission) {
      return res.status(404).json({ success: false, message: 'Requirement not found' });
    }

    if (String(req.user?.role || '').toLowerCase() === 'coach') {
      const context = await getCoachRequirementContext(
        req,
        submission,
        normalizeParticipationType(req.query.participationType)
      );
      if (!context) {
        return res.status(403).json({ success: false, message: 'You are not authorized to access this requirement.' });
      }
    } else if (await denyScreenerDepartmentMismatch(req, res, submission)) {
      return;
    }
    if (role === 'screener' && submission.coachStatus !== 'approved') {
      return res.status(409).json({
        success: false,
        message: 'This requirement is not available until its sport group is approved by the coach.'
      });
    }

    const requestedFileIndex = Number(req.query.fileIndex || 0);
    const storedFiles = Array.isArray(submission.files) && submission.files.length > 0
      ? submission.files
      : [{
          fileName: submission.fileName,
          fileType: submission.fileType,
          fileSize: submission.fileSize,
          filePath: submission.filePath,
          fileData: submission.fileData
        }];
    if (!Number.isInteger(requestedFileIndex) || requestedFileIndex < 0 || requestedFileIndex >= storedFiles.length) {
      return res.status(404).json({ success: false, message: 'Uploaded file is no longer available' });
    }
    const selectedFile = storedFiles[requestedFileIndex];
    const fileBuffer = toFileBuffer(selectedFile.fileData);
    if (fileBuffer?.length) {
      const extension = path.extname(selectedFile.fileName || '').toLowerCase();
      const expectedMime = allowedRequirementTypes.get(extension);
      const storedMime = String(selectedFile.fileType || '').toLowerCase();
      if (!expectedMime || (storedMime && storedMime !== expectedMime) || fileBuffer.length > MAX_REQUIREMENT_FILE_SIZE) {
        return res.status(404).json({ success: false, message: 'Uploaded file is no longer available' });
      }

      const safeFileName = path.basename(selectedFile.fileName || 'requirement').replace(/[\r\n"\\/]/g, '_');
      res.setHeader('Content-Type', expectedMime);
      res.setHeader('Content-Disposition', `inline; filename="${safeFileName}"`);
      res.setHeader('Content-Type', storedMime || expectedMime);
      return res.send(fileBuffer);
    }

    const storedPath = selectedFile.filePath || '';
    const filePath = resolveStoredFilePath(storedPath);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'Uploaded file is no longer available' });
    }

    const extension = path.extname(selectedFile.fileName || filePath).toLowerCase();
    const expectedMime = allowedRequirementTypes.get(extension);
    const fileStats = fs.statSync(filePath);
    if (!expectedMime || selectedFile.fileType !== expectedMime || fileStats.size > MAX_REQUIREMENT_FILE_SIZE) {
      return res.status(404).json({ success: false, message: 'Uploaded file is no longer available' });
    }

    const safeFileName = path.basename(selectedFile.fileName || path.basename(filePath)).replace(/[\r\n"\\/]/g, '_');
    res.setHeader('Content-Type', expectedMime);
    res.setHeader('Content-Disposition', `inline; filename="${safeFileName}"`);
    return res.sendFile(filePath);
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Unable to download uploaded file' });
  }
};

router.get('/screener/requirements/:id/download', protect, authorize('admin', 'screener'), serveScreenerRequirementFile);
router.get('/screener/requirements/:id/preview', protect, authorize('admin', 'screener'), serveScreenerRequirementFile);
router.get('/coach/requirements/:id/download', protect, authorize('coach'), serveScreenerRequirementFile);
router.get('/coach/requirements/:id/preview', protect, authorize('coach'), serveScreenerRequirementFile);

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

const getCoachReviewStatus = (submission) => (
  normalizeRequirementStatus(submission?.coachStatus)
);

const getSportScopedSubmissions = (submissions, sport) => submissions.filter((submission) => {
  const submissionSports = splitRequirementSports(submission.sport || '')
    .map(normalizeScopeValue)
    .filter(Boolean);
  return !submissionSports.length
    || submissionSports.includes(normalizeScopeValue('General'))
    || submissionSports.includes(normalizeScopeValue(sport));
});

const isCoachApprovedSportGroup = (athletes, submissions, sport) => {
  if (!athletes.length) return false;

  return athletes.every((athlete) => {
    const athleteId = athlete?._id || athlete?.id || athlete?.userId;
    const athleteSubmissions = getSportScopedSubmissions(
      submissions.filter((submission) => String(submission.studentId?._id || submission.studentId) === String(athleteId)),
      sport
    ).filter((submission) => !['archived', 'expired'].includes(
      String(submission.requirementStatus || '').toLowerCase()
    ));
    const latestByRequirement = new Map();
    athleteSubmissions.forEach((submission) => {
      const requirementType = submission.requirementType === 'medical' ? 'med' : submission.requirementType;
      const key = requirementType === 'other'
        ? `other:${submission.customRequirementId || submission.customRequirementLabel || submission._id}`
        : requirementType;
      const previous = latestByRequirement.get(key);
      if (!previous || new Date(submission.uploadDate || submission.createdAt || 0)
        > new Date(previous.uploadDate || previous.createdAt || 0)) {
        latestByRequirement.set(key, submission);
      }
    });

    const requiredTypes = ['med', 'psa', 'insurance', 'profile', 'consent'];
    return requiredTypes.every((type) => latestByRequirement.get(type)?.coachStatus === 'approved')
      && athleteSubmissions.every((submission) => submission.coachStatus === 'approved');
  });
};

const normalizeScopeValue = (value) => String(value || '')
  .normalize('NFKC')
  .replace(/[^\p{L}\p{N}]+/gu, '')
  .toLowerCase();

const normalizeDepartmentValue = (value) => String(value || '')
  .normalize('NFKC')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const collectCoachSports = (coach) => {
  const sports = [
    ...(Array.isArray(coach?.assignedSports) ? coach.assignedSports : []),
    ...(Array.isArray(coach?.sports) ? coach.sports : []),
    ...(Array.isArray(coach?.sportParticipation)
      ? coach.sportParticipation.map((entry) => entry?.sport)
      : []),
    coach?.sport,
  ];

  return new Set(sports.map(normalizeScopeValue).filter(Boolean));
};

const collectCoachEvents = (coach) => {
  const assignedEvents = [
    ...(Array.isArray(coach?.assignedEvents) ? coach.assignedEvents : []),
    ...(Array.isArray(coach?.assignedParticipationTypes) ? coach.assignedParticipationTypes : []),
    ...(Array.isArray(coach?.events) ? coach.events : []),
    ...(Array.isArray(coach?.eventAssignments) ? coach.eventAssignments : []),
    ...(Array.isArray(coach?.sportParticipation)
      ? coach.sportParticipation.map((entry) => entry?.participationType || entry?.event)
      : []),
  ].map((event) => (
    typeof event === 'string'
      ? event
      : event?.participationType || event?.event || event?.name || event?.title
  ));

  return new Set(assignedEvents.map(normalizeScopeValue).filter(Boolean));
};

const findCoachAccount = async (coachId) => User.findById(coachId)
  .select('role sport sports assignedSports sportParticipation assignedEvents assignedParticipationTypes events eventAssignments')
  .lean();

const findStudentForCoachRequirement = async (studentId) => {
  if (!studentId) return null;

  let student;
  try {
    student = await User.findOne({ _id: studentId, role: 'student' })
      .select('role id sport sports assignedSports sportParticipation')
      .lean();
  } catch (error) {
    if (!/Cast to ObjectId/i.test(error.message || '')) throw error;
  }

  if (!student) {
    student = await User.findOne({ id: String(studentId), role: 'student' })
      .select('role id sport sports assignedSports sportParticipation')
      .lean();
  }

  return student;
};

const getCoachRequirementContext = async (req, submission, participationType) => {
  if (String(req.user?.role || '').toLowerCase() !== 'coach') return null;

  const coachId = req.user?._id || req.user?.id;
  const coach = coachId ? await findCoachAccount(coachId) : null;
  if (!coach || coach.role !== 'coach') return null;

  const assignedSports = collectCoachSports(coach);
  if (!assignedSports.size) return null;

  const studentId = submission.studentId?._id || submission.studentId;
  const student = await findStudentForCoachRequirement(studentId);
  if (!student) return null;

  const athleteProfiles = await StudentAthlete.find({ userId: student._id })
    .select('sport sports assignedSports sportParticipation')
    .lean();
  const athleteProfile = athleteProfiles[0] || {};
  const studentSports = new Set([
    ...getStudentSports(student),
    ...getStudentSports(athleteProfile),
  ].map(normalizeScopeValue).filter(Boolean));
  const assignedStudentSports = [...studentSports].filter((sport) => assignedSports.has(sport));
  if (!assignedStudentSports.length) return null;

  const eventScope = collectCoachEvents(coach);
  const submissionEvent = normalizeScopeValue(submission.participationType || participationType || 'Intrams');
  if (eventScope.size && !eventScope.has(submissionEvent)) return null;

  const submissionSports = splitRequirementSports(submission.sport || '')
    .map(normalizeScopeValue)
    .filter(Boolean);
  if (submissionSports.length && !submissionSports.includes(normalizeScopeValue('General'))
    && !submissionSports.some((sport) => assignedSports.has(sport) && studentSports.has(sport))) {
    return null;
  }

  return {
    coach,
    student,
    assignedStudentSports,
  };
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

const denyScreenerDepartmentMismatch = async (req, res, submission) => {
  if (String(req.user?.role || '').toLowerCase() !== 'screener') return false;

  const screenerDepartment = normalizeDepartmentValue(req.user.department);
  if (!screenerDepartment) {
    res.status(403).json({ success: false, message: 'Screener department is not configured.' });
    return true;
  }

  const student = await findStudentForSubmission(submission.studentId);
  const studentDepartment = normalizeDepartmentValue(student?.department);
  if (!studentDepartment || studentDepartment !== screenerDepartment) {
    res.status(403).json({ success: false, message: 'You are not authorized to access this requirement.' });
    return true;
  }

  return false;
};

// @desc    Get all student requirement submissions for the screener portal
// @route   GET /api/v1/screener/requirements
// @access  Private/Screener
router.get('/screener/requirements', protect, authorize('admin', 'screener'), async (req, res) => {
  console.log('🔍 Screener requirements request:', { 
    path: req.originalUrl, 
    method: req.method, 
    userRole: req.user?.role,
    userId: req.user?._id
  });
  
  try {
    const isScreener = String(req.user?.role || '').toLowerCase() === 'screener';
    const screenerDepartment = normalizeDepartmentValue(req.user?.department);
    if (isScreener && !screenerDepartment) {
      return res.status(403).json({ success: false, message: 'Screener department is not configured.' });
    }

    // Get all students
    const participationTypes = req.query.participationType
      ? [normalizeParticipationType(req.query.participationType)]
      : ['Intrams', 'STRASUC'];
    const studentsFromDb = await User.find({ role: 'student', accountStatus: { $ne: 'archived' } })
      .select('fullname username department createdAt sport sports assignedSports sportParticipation')
      .sort({ createdAt: -1 })
      .lean();
    const visibleStudents = isScreener
      ? studentsFromDb.filter((student) => normalizeDepartmentValue(student.department) === screenerDepartment)
      : studentsFromDb;

    const athleteProfiles = visibleStudents.length
      ? await StudentAthlete.find({ userId: { $in: visibleStudents.map((student) => student._id) } })
        .select('userId sport sports assignedSports sportParticipation yearLevel')
        .lean()
      : [];
    const athleteProfilesByUserId = new Map(
      athleteProfiles.map((profile) => [String(profile.userId), profile])
    );
    
    console.log(`👥 Found ${studentsFromDb.length} students in database`);

    // Get all student requirements submissions
    const submissionsByParticipation = await Promise.all(participationTypes.map(async (participationType) => {
      const RequirementModel = getStudentRequirementModel(participationType);
      const participationFilter = participationType === 'Intrams'
        ? { $or: [{ participationType: 'Intrams' }, { participationType: { $exists: false } }] }
        : { participationType: 'STRASUC' };
      const activeSubmissionConditions = [
        participationFilter,
        { requirementStatus: { $nin: ['archived', 'expired'] } }
      ];
      if (isScreener) {
        activeSubmissionConditions.push({
          studentId: { $in: visibleStudents.map((student) => student._id) }
        });
      }
      const activeSubmissionFilter = { $and: activeSubmissionConditions };
      let submissionsQuery = RequirementModel.find(activeSubmissionFilter)
        .select('studentId requirementType participationType customRequirementId customRequirementLabel requirementStatus sport fileName fileType fileSize filePath files.fileName files.fileType files.fileSize files.filePath status coachStatus resubmitted uploadDate createdAt remarks')
        .sort({ uploadDate: -1, _id: -1 });
      submissionsQuery = submissionsQuery.populate('studentId', 'fullname department yearLevel sport sports assignedSports id username');
      const submissions = await submissionsQuery.lean();
      return submissions.map((submission) => ({
        ...submission,
        participationType: submission.participationType || participationType
      }));
    }));
    const submissions = submissionsByParticipation.flat()
      .sort((submissionA, submissionB) => (
        new Date(submissionB.uploadDate || submissionB.createdAt || 0)
        - new Date(submissionA.uploadDate || submissionA.createdAt || 0)
      ));

    const athletesBySport = new Map();
    visibleStudents.forEach((student) => {
      const profile = athleteProfilesByUserId.get(String(student._id)) || {};
      const sports = getSavedSports(profile.sports);
      sports.forEach((sport) => {
        const key = normalizeScopeValue(sport);
        if (!athletesBySport.has(key)) athletesBySport.set(key, { sport, athletes: [] });
        athletesBySport.get(key).athletes.push(student);
      });
    });
    const readySports = new Set(
      [...athletesBySport.entries()]
        .filter(([, group]) => isCoachApprovedSportGroup(group.athletes, submissions, group.sport))
        .map(([key]) => key)
    );

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
      if (isScreener && normalizeDepartmentValue(studentDepartment) !== screenerDepartment) continue;

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
      const attachmentFiles = Array.isArray(submission.files) && submission.files.length > 0
        ? submission.files
        : [{
            fileName: submission.fileName,
            fileType: submission.fileType,
            fileSize: submission.fileSize,
            filePath: submission.filePath
          }];
      const hasUpload = attachmentFiles.some((file) => (
        Number(file.fileSize) > 0
        || Boolean(resolveStoredFilePath(file.filePath))
      ));
      const fileUrl = `/screener/requirements/${submission._id}/preview?participationType=${encodeURIComponent(submission.participationType || 'Intrams')}`;
      const document = {
        submissionId: submission._id,
        requirementType: submission.requirementType,
        customRequirementId: submission.customRequirementId || '',
        status: normalizeRequirementStatus(submission.status),
        coachStatus: getCoachReviewStatus(submission),
        resubmitted: submission.resubmitted || false,
        label: submission.customRequirementLabel || requirementKeyLabels[submission.requirementType] || submission.requirementType,
        fileName: submission.fileName || 'Uploaded file',
        fileType: submission.fileType || '',
        fileUrl,
        files: attachmentFiles.map((file, index) => ({
          fileName: file.fileName || 'Uploaded file',
          fileType: file.fileType || '',
          fileUrl: `${fileUrl}&fileIndex=${index}`
        })),
        uploadedAt: submission.uploadDate || submission.createdAt,
        remarks: submission.remarks || '',
        hasUpload,
        participationType: submission.participationType || 'Intrams',
        sport: submission.sport || studentEntry.sport
      };
      studentEntry.requirements.documents.push(document);

      const currentEntry = studentEntry.requirements[normalizedKey];
      if (!currentEntry || new Date(document.uploadedAt || 0) > new Date(currentEntry.uploadedAt || 0)) {
        studentEntry.requirements[normalizedKey] = document;
      }
    }

    // Convert map to array and add overall status
    const students = Array.from(studentsById.values()).flatMap((student) => {
      const readyStudentSports = student.sports.filter((sport) => readySports.has(normalizeScopeValue(sport)));
      if (!readyStudentSports.length) return [];

      const eligibleDocuments = student.requirements.documents.filter((document) => {
        if (document.coachStatus !== 'approved') return false;
        const documentSports = splitRequirementSports(document.sport || '')
          .map(normalizeScopeValue)
          .filter(Boolean);
        return !documentSports.length
          || documentSports.includes(normalizeScopeValue('General'))
          || documentSports.some((sport) => readyStudentSports.some((readySport) => normalizeScopeValue(readySport) === sport));
      });
      if (!eligibleDocuments.length) return [];

      const requirements = {
        cor: null,
        med: null,
        psa: null,
        insurance: null,
        profile: null,
        consent: null,
        documents: eligibleDocuments
      };
      eligibleDocuments.forEach((document) => {
        const key = document.requirementType === 'medical' ? 'med' : document.requirementType;
        const currentEntry = requirements[key];
        if (!currentEntry || new Date(document.uploadedAt || 0) > new Date(currentEntry.uploadedAt || 0)) {
          requirements[key] = document;
        }
      });

      return [{
        ...student,
        sport: readyStudentSports[0],
        sports: readyStudentSports,
        requirements,
        overallStatus: deriveOverallStatus(requirements)
      }];
    });

    console.log(`✅ Returning ${students.length} students with requirements`);

    res.json({
      success: true,
      count: students.length,
      assignedDepartment: isScreener ? String(req.user.department || '').trim() : null,
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

router.get('/coach/requirements', protect, authorize('coach'), async (req, res) => {
  try {
    const coachId = req.user?._id || req.user?.id;
    const coach = coachId ? await findCoachAccount(coachId) : null;
    if (String(req.user?.role || '').toLowerCase() !== 'coach' || !coach || coach.role !== 'coach') {
      return res.status(403).json({ success: false, message: 'Coach access could not be verified.' });
    }

    const assignedSports = collectCoachSports(coach);
    if (!assignedSports.size) {
      return res.json({ success: true, count: 0, data: [] });
    }

    const [registeredStudents, athleteProfiles] = await Promise.all([
      User.find({ role: 'student', accountStatus: { $ne: 'archived' } })
        .select('fullname username id department yearLevel sport sports assignedSports sportParticipation createdAt')
        .sort({ createdAt: -1 })
        .lean(),
      StudentAthlete.find({})
        .select('userId id studentNumber fullname department yearLevel sport sports assignedSports sportParticipation')
        .lean(),
    ]);

    const profilesByUserId = new Map();
    athleteProfiles.forEach((profile) => {
      if (profile.userId && !profilesByUserId.has(String(profile.userId))) {
        profilesByUserId.set(String(profile.userId), profile);
      }
    });

    const studentsById = new Map();
    const assignedStudentIds = [];
    const eventScope = collectCoachEvents(coach);
    registeredStudents.forEach((student) => {
      const studentId = String(student._id);
      const profile = profilesByUserId.get(studentId) || {};
      const studentSports = new Map([
        ...getStudentSports(student),
        ...getStudentSports(profile),
      ].map((sport) => [normalizeScopeValue(sport), String(sport || '').trim()]).filter(([sport, label]) => sport && label));
      const matchedSports = [...studentSports.entries()]
        .filter(([sport]) => assignedSports.has(sport))
        .map(([, label]) => label);
      if (!matchedSports.length) return;

      studentsById.set(studentId, {
        student,
        profile,
        matchedSports,
        entry: {
          id: studentId,
          name: student.fullname || student.username || profile.fullname || 'Unknown Student',
          department: student.department || profile.department || 'Not specified',
          sport: matchedSports[0],
          sports: matchedSports,
          yearLevel: student.yearLevel || profile.yearLevel || '',
          requirements: {
            cor: null,
            med: null,
            psa: null,
            insurance: null,
            profile: null,
            consent: null,
            documents: [],
          },
        },
      });
      assignedStudentIds.push(student._id);
    });

    if (!assignedStudentIds.length) {
      return res.json({ success: true, count: 0, data: [] });
    }

    const submissionsByEvent = await Promise.all(['Intrams', 'STRASUC'].map(async (participationType) => {
      if (eventScope.size && !eventScope.has(normalizeScopeValue(participationType))) return [];

      const RequirementModel = getStudentRequirementModel(participationType);
      const participationFilter = participationType === 'Intrams'
        ? { $or: [{ participationType: 'Intrams' }, { participationType: { $exists: false } }] }
        : { participationType: 'STRASUC' };

      return RequirementModel.find({
        $and: [
          participationFilter,
          { requirementStatus: { $nin: ['archived', 'expired'] } },
          { studentId: { $in: assignedStudentIds } },
        ],
      })
        .select('studentId requirementType participationType customRequirementId customRequirementLabel requirementStatus fileName fileType fileSize filePath files.fileName files.fileType files.fileSize files.filePath status coachStatus coachRemarks resubmitted uploadDate createdAt remarks sport')
        .sort({ uploadDate: -1, _id: -1 })
        .lean()
        .then((eventSubmissions) => eventSubmissions.map((submission) => ({
          ...submission,
          participationType: submission.participationType || participationType,
        })));
    }));

    const submissions = submissionsByEvent.flat();
    submissions.forEach((submission) => {
      const participationType = submission.participationType || 'Intrams';
      if (eventScope.size && !eventScope.has(normalizeScopeValue(participationType))) return;

      const studentId = String(submission.studentId?._id || submission.studentId || '');
      const matchedStudent = studentsById.get(studentId);
      if (!matchedStudent) return;

      const submissionSports = splitRequirementSports(submission.sport || '')
        .map(normalizeScopeValue)
        .filter(Boolean);
      if (submissionSports.length && !submissionSports.includes(normalizeScopeValue('General'))
        && !submissionSports.some((sport) => assignedSports.has(sport)
          && matchedStudent.matchedSports.some((matchedSport) => normalizeScopeValue(matchedSport) === sport))) {
        return;
      }

      const fileList = Array.isArray(submission.files) && submission.files.length
        ? submission.files
        : [{
            fileName: submission.fileName,
            fileType: submission.fileType,
            fileSize: submission.fileSize,
            filePath: submission.filePath,
          }];
      const hasUpload = fileList.some((file) => (
        Number(file.fileSize) > 0 || Boolean(resolveStoredFilePath(file.filePath))
      ));
      const fileUrl = `/coach/requirements/${submission._id}/preview?participationType=${encodeURIComponent(participationType)}`;
      const document = {
        submissionId: submission._id,
        requirementType: submission.requirementType,
        customRequirementId: submission.customRequirementId || '',
        status: getCoachReviewStatus(submission),
        finalStatus: normalizeRequirementStatus(submission.status),
        resubmitted: Boolean(submission.resubmitted),
        label: submission.customRequirementLabel
          || requirementKeyLabels[submission.requirementType]
          || submission.requirementType,
        fileName: submission.fileName || 'Uploaded file',
        fileType: submission.fileType || '',
        fileUrl,
        files: fileList.map((file, index) => ({
          fileName: file.fileName || 'Uploaded file',
          fileType: file.fileType || '',
          fileUrl: `${fileUrl}&fileIndex=${index}`,
        })),
        uploadedAt: submission.uploadDate || submission.createdAt,
        remarks: submission.coachRemarks || submission.remarks || '',
        hasUpload,
        participationType,
        sport: submission.sport || matchedStudent.entry.sport,
      };

      matchedStudent.entry.requirements.documents.push(document);
      const normalizedKey = submission.requirementType === 'medical' ? 'med' : submission.requirementType;
      const currentEntry = matchedStudent.entry.requirements[normalizedKey];
      if (!currentEntry || new Date(document.uploadedAt || 0) > new Date(currentEntry.uploadedAt || 0)) {
        matchedStudent.entry.requirements[normalizedKey] = document;
      }
    });

    const roster = [...studentsById.values()];
    const sportBatchStatuses = new Map();
    const allCoachSports = new Map();
    roster.forEach((athlete) => athlete.matchedSports.forEach((sport) => {
      allCoachSports.set(normalizeScopeValue(sport), sport);
    }));

    allCoachSports.forEach((sport, sportKey) => {
      const sportRoster = roster
        .filter((athlete) => athlete.matchedSports.some((matchedSport) => normalizeScopeValue(matchedSport) === sportKey));
      const ready = isCoachApprovedSportGroup(
        sportRoster.map(({ student }) => student),
        submissions,
        sport
      );
      const approvedAthletes = sportRoster.filter(({ entry }) => (
        isCoachApprovedSportGroup([entry], submissions, sport)
      )).length;
      sportBatchStatuses.set(sportKey, {
        sport,
        ready,
        approvedAthletes,
        totalAthletes: sportRoster.length,
      });
    });

    const data = roster.map(({ entry }) => {
      const batchStatusBySport = entry.sports.map((sport) => (
        sportBatchStatuses.get(normalizeScopeValue(sport))
      )).filter(Boolean);
      const allCoachDocumentsApproved = entry.requirements.documents
        .every((document) => document.status === 'approved');
      const overallStatus = deriveOverallStatus(entry.requirements) === 'Completed' && allCoachDocumentsApproved
        ? 'Coach-Approved'
        : 'Incomplete';
      return {
        ...entry,
        batchStatusBySport,
        overallStatus,
      };
    });

    return res.json({ success: true, count: data.length, data });
  } catch (error) {
    console.error('Coach requirements error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to load coach requirements.',
    });
  }
});

// @desc    Mark a resubmitted requirement as viewed by the screener
// @route   PUT /api/v1/screener/requirements/:id/viewed
// @access  Private/Screener
router.put('/screener/requirements/:id/viewed', protect, authorize('admin', 'screener'), async (req, res) => {
  try {
    const { id } = req.params;
    const RequirementModel = getStudentRequirementModel(req.body?.participationType);
    const submission = await RequirementModel.findById(id);
    if (!submission) {
      return res.status(404).json({ success: false, message: 'Submission not found' });
    }
    if (await denyScreenerDepartmentMismatch(req, res, submission)) return;
    if (String(req.user?.role || '').toLowerCase() === 'screener' && submission.coachStatus !== 'approved') {
      return res.status(409).json({
        success: false,
        message: 'This requirement is not available until its sport group is approved by the coach.'
      });
    }

    submission.resubmitted = false;
    await submission.save();

    res.json({ success: true, message: 'Requirement resubmission marked as viewed', data: submission });
  } catch (error) {
    console.error('❌ Mark resubmission viewed error:', error);
    res.status(500).json({ success: false, message: 'An unexpected server error occurred. Please try again.' });
  }
});

router.put('/coach/requirements/:id/viewed', protect, authorize('coach'), async (req, res) => {
  try {
    const RequirementModel = getStudentRequirementModel(req.body?.participationType);
    const submission = await RequirementModel.findById(req.params.id);
    if (!submission) {
      return res.status(404).json({ success: false, message: 'Submission not found' });
    }

    const context = await getCoachRequirementContext(
      req,
      submission,
      normalizeParticipationType(req.body?.participationType)
    );
    if (!context) {
      return res.status(403).json({ success: false, message: 'You are not authorized to access this requirement.' });
    }

    submission.resubmitted = false;
    await submission.save();
    return res.json({ success: true, message: 'Requirement resubmission marked as viewed', data: submission });
  } catch (error) {
    console.error('Coach requirement viewed error:', error);
    return res.status(500).json({ success: false, message: 'Unable to update requirement notification.' });
  }
});

// @desc    Review a student requirement submission
// @route   PUT /api/v1/screener/requirements/:id/review
// @access  Private/Screener
router.put('/screener/requirements/:id/review', protect, authorize('admin', 'screener'), async (req, res) => {
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

    if (await denyScreenerDepartmentMismatch(req, res, submission)) return;
    if (String(req.user?.role || '').toLowerCase() === 'screener' && submission.coachStatus !== 'approved') {
      return res.status(409).json({
        success: false,
        message: 'This requirement is not available until its sport group is approved by the coach.'
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

router.put('/coach/requirements/:id/review', protect, authorize('coach'), async (req, res) => {
  try {
    const { status, feedback = '', remarks = '', studentId, participationType } = req.body;
    const normalizedStatus = String(status || '').toLowerCase();
    if (!['approved', 'rejected', 'pending'].includes(normalizedStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid review status. Must be: approved, rejected, or pending',
      });
    }
    if (normalizedStatus === 'rejected' && !studentId) {
      return res.status(400).json({ success: false, message: 'Student context is required' });
    }

    const RequirementModel = getStudentRequirementModel(participationType);
    const submission = await RequirementModel.findById(req.params.id);
    if (!submission) {
      return res.status(404).json({ success: false, message: 'Submission not found' });
    }

    const context = await getCoachRequirementContext(
      req,
      submission,
      normalizeParticipationType(participationType)
    );
    if (!context || (studentId && String(submission.studentId) !== String(studentId))) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to modify this requirement.',
      });
    }

    submission.coachStatus = normalizedStatus;
    submission.coachRemarks = [feedback, remarks].filter(Boolean).join(' — ');
    submission.coachReviewedAt = new Date();
    submission.coachReviewedBy = req.user?._id || req.user?.id || null;
    if (normalizedStatus === 'rejected') {
      submission.status = 'rejected';
      submission.remarks = submission.coachRemarks;
      submission.reviewedAt = submission.coachReviewedAt;
      submission.reviewedBy = submission.coachReviewedBy;
      submission.notificationReadAt = null;
    } else if (normalizedStatus === 'pending') {
      submission.status = 'pending';
      submission.remarks = submission.coachRemarks;
    }
    submission.resubmitted = false;
    await submission.save();

    return res.json({
      success: true,
      message: normalizedStatus === 'rejected'
        ? 'Requirement rejected and retained for re-upload'
        : `Requirement ${normalizedStatus} successfully`,
      data: {
        id: submission._id,
        status: submission.status,
        coachStatus: submission.coachStatus,
        remarks: submission.remarks,
        reviewedAt: submission.coachReviewedAt,
      },
    });
  } catch (error) {
    console.error('Coach requirement review error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to review this requirement.',
    });
  }
});

module.exports = router;