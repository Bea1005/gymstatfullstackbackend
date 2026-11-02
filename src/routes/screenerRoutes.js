const express = require('express');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const User = require('../models/User');
const StudentAthlete = require('../models/StudentAthlete');
const {
  getStudentRequirementModel,
  normalizeParticipationType
} = require('../models/studentRequirementCollections');
const { getStudentSports, splitRequirementSports } = require('../utils/requirementSports');
const Requirement = require('../models/Requirement');

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
    } else {
      if (await denyScreenerDepartmentMismatch(req, res, submission)) return;
      if (await denyScreenerSportMismatch(req, res, submission, req.query.sport)) return;
    }
    if (role === 'screener' && submission.coachStatus !== 'approved') {
      return res.status(409).json({
        success: false,
        message: 'This requirement is not available until its sport group is approved by the coach.'
      });
    }
    if (denyUnforwardedScreenerSubmission(req, res, submission)) return;

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

const isActiveRequirement = (submission) => (
  String(submission?.requirementStatus || '').toLowerCase() === 'active'
);

const getSavedSports = (sports) => Array.from(new Set(
  (Array.isArray(sports) ? sports : [])
    .filter((sport) => typeof sport === 'string')
    .map((sport) => sport.trim())
    .filter(Boolean)
));

const deriveOverallStatus = (requirements) => {
  const documents = Array.isArray(requirements?.documents) ? requirements.documents : [];
  const latestByRequirement = new Map();
  documents.forEach((document) => {
    const requirementType = String(document?.requirementType || '').toLowerCase();
    const normalizedType = requirementType === 'medical' ? 'med' : requirementType;
    const key = normalizedType === 'other'
      ? `other:${document.customRequirementId || document.submissionId || document._id}`
      : normalizedType;
    const previous = latestByRequirement.get(key);
    if (!previous || new Date(document.uploadedAt || 0) > new Date(previous.uploadedAt || 0)) {
      latestByRequirement.set(key, document);
    }
  });
  const requiredCategoriesApproved = ['med', 'psa', 'insurance', 'profile', 'consent']
    .every((key) => latestByRequirement.get(key)?.status === 'approved');
  const otherRequiredDocumentsApproved = [...latestByRequirement.values()]
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
      && [...latestByRequirement.values()].every((submission) => submission.coachStatus === 'approved');
  });
};

const normalizeScopeValue = (value) => String(value || '')
  .normalize('NFKC')
  .replace(/[^\p{L}\p{N}]+/gu, '')
  .toLowerCase();

const getCoachForwardingReadiness = (roster, submissions, eventScope) => {
  const latestSubmissionsByRequirement = new Map();

  roster.forEach(({ student, matchedSports }) => {
    const studentId = String(student?._id || student?.id || student?.userId || '');
    const studentSubmissions = submissions.filter((submission) => (
      String(submission.studentId?._id || submission.studentId || '') === studentId
    ) && isActiveRequirement(submission));

    matchedSports.forEach((sport) => {
      const sportSubmissions = getSportScopedSubmissions(studentSubmissions, sport);
      const participationTypes = [...new Set(sportSubmissions
        .map((submission) => submission.participationType || 'Intrams')
        .filter((event) => (
          !eventScope.size || eventScope.has(normalizeScopeValue(event))
        )))];

      participationTypes.forEach((participationType) => {
        const eventSubmissions = sportSubmissions.filter((submission) => (
          normalizeScopeValue(submission.participationType || 'Intrams')
          === normalizeScopeValue(participationType)
        ));
        eventSubmissions.forEach((submission) => {
          const requirementType = String(submission.requirementType || '').toLowerCase();
          const normalizedType = requirementType === 'medical' ? 'med' : requirementType;
          const requirementKey = normalizedType === 'other'
            ? `other:${submission.customRequirementId || submission.customRequirementLabel || submission._id}`
            : normalizedType;
          const key = [
            studentId,
            normalizeScopeValue(sport),
            normalizeScopeValue(participationType),
            requirementKey,
          ].join(':');
          const current = latestSubmissionsByRequirement.get(key);
          if (!current || new Date(submission.uploadDate || submission.createdAt || 0)
            > new Date(current.uploadDate || current.createdAt || 0)) {
            latestSubmissionsByRequirement.set(key, submission);
          }
        });
      });
    });
  });

  const applicableSubmissions = [...latestSubmissionsByRequirement.values()];
  return {
    ready: applicableSubmissions.length > 0
      && applicableSubmissions.every((submission) => submission.coachStatus === 'approved'),
    submissions: applicableSubmissions,
  };
};

const normalizeDepartmentValue = (value) => String(value || '')
  .normalize('NFKC')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const collectCoachSportLabels = (coach) => {
  const sports = [
    ...(Array.isArray(coach?.assignedSports) ? coach.assignedSports : []),
    ...(Array.isArray(coach?.sports) ? coach.sports : []),
    ...(Array.isArray(coach?.sportParticipation)
      ? coach.sportParticipation.map((entry) => entry?.sport)
      : []),
    coach?.sport,
  ];

  return [...new Map(sports
    .map((sport) => [normalizeScopeValue(sport), String(sport || '').trim()])
    .filter(([normalized, label]) => normalized && label)).values()];
};

const collectCoachSports = (coach) => new Set(
  collectCoachSportLabels(coach).map(normalizeScopeValue).filter(Boolean)
);

const getCoachPrimarySport = (coach) => {
  const sportLabels = collectCoachSportLabels(coach);
  const primarySport = normalizeScopeValue(coach?.sport);
  return sportLabels.find((sport) => normalizeScopeValue(sport) === primarySport)
    || sportLabels[0]
    || '';
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
  .select('role sport sports assignedSports sportParticipation assignedEvents assignedParticipationTypes events eventAssignments strasucStudentIds')
  .lean();

const getCoachGalleryRoster = async (coach) => {
  const assignedStudentIds = Array.isArray(coach?.strasucStudentIds)
    ? [...new Set(coach.strasucStudentIds.map(String))]
    : [];
  if (!assignedStudentIds.length) return [];

  const students = await User.find({
    role: 'student',
    _id: { $in: assignedStudentIds },
  })
    .select('fullname username id studentNumber department yearLevel sport sports assignedSports sportParticipation')
    .lean();
  if (!students.length) return [];

  const profileLinks = [
    { userId: { $in: students.map((student) => student._id) } },
    { id: { $in: students.map((student) => student.id).filter(Boolean) } },
    { studentNumber: { $in: students.map((student) => student.studentNumber).filter(Boolean) } },
  ];
  let profileQuery = StudentAthlete.find({ $or: profileLinks })
    .select('userId id studentNumber fullname department yearLevel sport sports assignedSports sportParticipation updatedAt');
  if (typeof profileQuery.sort === 'function') {
    profileQuery = profileQuery.sort({ updatedAt: -1 });
  }
  const profiles = await profileQuery.lean();

  const usersById = new Map(students.map((student) => [String(student._id), student]));
  const usersByRegisteredId = new Map(students
    .filter((student) => student.id)
    .map((student) => [String(student.id), student]));
  const usersByStudentNumber = new Map(students
    .filter((student) => student.studentNumber)
    .map((student) => [String(student.studentNumber), student]));
  const profilesByUserId = new Map();
  profiles.forEach((profile) => {
    const user = usersById.get(String(profile.userId || ''))
      || usersByRegisteredId.get(String(profile.id || ''))
      || usersByStudentNumber.get(String(profile.studentNumber || ''));
    if (user && !profilesByUserId.has(String(user._id))) {
      profilesByUserId.set(String(user._id), profile);
    }
  });

  return students.map((student) => ({
    student,
    profile: profilesByUserId.get(String(student._id)) || {},
  }));
};

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
  const primarySportKey = normalizeScopeValue(getCoachPrimarySport(coach));

  const studentId = submission.studentId?._id || submission.studentId;
  const student = await findStudentForCoachRequirement(studentId);
  if (!student) return null;
  const galleryStudent = (await getCoachGalleryRoster(coach))
    .find(({ student: assignedStudent }) => String(assignedStudent._id) === String(student._id));
  if (!galleryStudent) return null;

  const athleteProfile = galleryStudent.profile;
  const studentSports = new Set([
    ...getStudentSports(student),
    ...getStudentSports(athleteProfile),
  ].map(normalizeScopeValue).filter(Boolean));
  const assignedStudentSports = [...studentSports].filter((sport) => (
    sport === primarySportKey && assignedSports.has(sport)
  ));
  if (!assignedStudentSports.length) return null;

  const eventScope = collectCoachEvents(coach);
  const submissionEvent = normalizeScopeValue(submission.participationType || participationType || 'Intrams');
  if (eventScope.size && !eventScope.has(submissionEvent)) return null;

  const submissionSports = splitRequirementSports(submission.sport || '')
    .map(normalizeScopeValue)
    .filter(Boolean);
  if (submissionSports.length && !submissionSports.includes(normalizeScopeValue('General'))
    && !submissionSports.includes(primarySportKey)) {
    return null;
  }

  return {
    coach,
    student,
    assignedStudentSports,
  };
};

const getCoachForwardingContext = async (coach, selectedSport) => {
  const assignedSports = collectCoachSports(coach);
  const selectedSportKey = normalizeScopeValue(selectedSport);
  if (!assignedSports.size || !selectedSportKey || !assignedSports.has(selectedSportKey)) {
    return { ready: false, submissions: [] };
  }

  const galleryRoster = await getCoachGalleryRoster(coach);
  const roster = galleryRoster.map(({ student, profile }) => {
    const matchedSports = [...new Set([
      ...getStudentSports(student),
      ...getStudentSports(profile),
    ].map(normalizeScopeValue).filter((sport) => (
      sport === selectedSportKey && assignedSports.has(sport)
    )))];
    return { student, matchedSports };
  }).filter(({ matchedSports }) => matchedSports.length > 0);

  if (!roster.length) return { ready: false, submissions: [] };

  const eventScope = collectCoachEvents(coach);
  const assignedStudentIds = roster.map(({ student }) => student._id);
  const submissionsByEvent = await Promise.all(['Intrams', 'STRASUC'].map(async (participationType) => {
    if (eventScope.size && !eventScope.has(normalizeScopeValue(participationType))) return [];

    const RequirementModel = getStudentRequirementModel(participationType);
    const participationFilter = participationType === 'Intrams'
      ? { $or: [{ participationType: 'Intrams' }, { participationType: { $exists: false } }] }
      : { participationType: 'STRASUC' };

    const submissions = await RequirementModel.find({
      $and: [
        participationFilter,
        { requirementStatus: 'active' },
        { studentId: { $in: assignedStudentIds } },
      ],
    })
      .select('studentId requirementType participationType customRequirementId customRequirementLabel requirementStatus coachStatus status sport screenerForwardedAt uploadDate createdAt')
      .lean();
    return submissions.filter(isActiveRequirement).map((submission) => ({
      ...submission,
      participationType: submission.participationType || participationType,
    }));
  }));
  const allSubmissions = submissionsByEvent.flat();
  // Exclude submissions linked to archived or inactive Requirement templates.
  // Built-in types (med, psa, cor, insurance, profile, consent) have no parent
  // template and are always included. Only custom other-type submissions are
  // cross-referenced against the Requirement template status.
  const fwdCustomIds = [...new Set(
    allSubmissions
      .filter((s) => String(s.requirementType || '').toLowerCase() === 'other' && s.customRequirementId)
      .map((s) => s.customRequirementId)
  )];
  let fwdActiveTemplateIds = new Set();
  if (fwdCustomIds.length) {
    const fwdActiveTemplates = await Requirement.find({
      _id: { $in: fwdCustomIds },
      status: { $in: ['published'] },
      isActive: { $ne: false },
    }).select('_id').lean();
    fwdActiveTemplateIds = new Set(fwdActiveTemplates.map((t) => String(t._id)));
  }
  const activeAllSubmissions = allSubmissions.filter((s) => {
    if (String(s.requirementType || '').toLowerCase() !== 'other') return true;
    if (!s.customRequirementId) return true;
    return fwdActiveTemplateIds.has(String(s.customRequirementId));
  });

  const rosterByStudentId = new Map(roster.map(({ student, matchedSports }) => [
    String(student._id),
    { student, matchedSports },
  ]));
  const inScopeSubmissions = activeAllSubmissions.filter((submission) => {
    const studentId = String(submission.studentId?._id || submission.studentId || '');
    const athlete = rosterByStudentId.get(studentId);
    if (!athlete) return false;

    const submissionSports = splitRequirementSports(submission.sport || '')
      .map(normalizeScopeValue)
      .filter(Boolean);
    return !submissionSports.length
      || submissionSports.includes(normalizeScopeValue('General'))
      || submissionSports.some((sport) => assignedSports.has(sport) && athlete.matchedSports.includes(sport));
  });
  const forwardingReadiness = getCoachForwardingReadiness(roster, inScopeSubmissions, eventScope);
  return forwardingReadiness;
};

const findStudentForSubmission = async (studentId) => {
  if (!studentId) return null;

  let student;
  try {
    let query = User.findById(studentId);
    if (query && typeof query.select === 'function') {
      query = query.select('department sport sports assignedSports sportParticipation');
      if (typeof query.lean === 'function') query = query.lean();
    }
    student = await query;
  } catch (error) {
    if (!/Cast to ObjectId/i.test(error.message || '')) throw error;
  }

  if (!student) {
    let query = User.findOne({ id: String(studentId) });
    if (query && typeof query.select === 'function') {
      query = query.select('department sport sports assignedSports sportParticipation');
      if (typeof query.lean === 'function') query = query.lean();
    }
    student = await query;
  }

  return student;
};

const denyScreenerSportMismatch = async (req, res, submission, requestedSport) => {
  if (String(req.user?.role || '').toLowerCase() !== 'screener' || !requestedSport) return false;

  const requestedSportKey = normalizeScopeValue(requestedSport);
  const student = await findStudentForSubmission(submission.studentId);
  if (!student || !requestedSportKey) {
    res.status(403).json({ success: false, message: 'You are not authorized to access this requirement.' });
    return true;
  }

  const profiles = await StudentAthlete.find({ userId: student._id })
    .select('sport sports assignedSports sportParticipation')
    .lean();
  const studentSports = [
    ...(Array.isArray(student.sports) ? student.sports : []),
    ...(profiles || []).flatMap((profile) => Array.isArray(profile.sports) ? profile.sports : []),
  ].map(normalizeScopeValue);
  const submissionSports = splitRequirementSports(submission.sport || '').map(normalizeScopeValue);
  if (!studentSports.includes(requestedSportKey)
    || (submissionSports.length
      && !submissionSports.includes(normalizeScopeValue('General'))
      && !submissionSports.includes(requestedSportKey))) {
    res.status(403).json({ success: false, message: 'You are not authorized to access this requirement.' });
    return true;
  }

  return false;
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

const denyUnforwardedScreenerSubmission = (req, res, submission) => {
  if (String(req.user?.role || '').toLowerCase() !== 'screener' || submission.screenerForwardedAt) {
    return false;
  }

  res.status(409).json({
    success: false,
    message: 'This requirement has not been forwarded to the Screener by the coach.',
  });
  return true;
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
    const requestedSportKey = normalizeScopeValue(req.query.sport);
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
    const visibleStudentsById = new Map(
      visibleStudents.map((student) => [String(student._id), student])
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
        activeSubmissionConditions.push({ screenerForwardedAt: { $ne: null } });
        activeSubmissionConditions.push({ coachStatus: 'approved' });
      }
      const activeSubmissionFilter = { $and: activeSubmissionConditions };
      let submissionsQuery = RequirementModel.find(activeSubmissionFilter)
        .select('studentId requirementType participationType customRequirementId customRequirementLabel requirementStatus sport fileName fileType fileSize filePath files.fileName files.fileType files.fileSize files.filePath status coachStatus screenerForwardedAt screenerForwardedBy resubmitted uploadDate createdAt remarks')
        .sort({ uploadDate: -1, _id: -1 });
      submissionsQuery = submissionsQuery.populate('studentId', 'fullname department yearLevel sport sports assignedSports id username');
      const submissions = await submissionsQuery.lean();
      return submissions.map((submission) => ({
        ...submission,
        participationType: submission.participationType || participationType
      }));
    }));
    const submissions = submissionsByParticipation.flat()
      .filter((submission) => {
        if (!requestedSportKey) return true;

        const studentId = String(submission.studentId?._id || submission.studentId || '');
        const student = visibleStudentsById.get(studentId);
        const athleteProfile = athleteProfilesByUserId.get(studentId) || {};
        const studentSports = [
          ...(Array.isArray(student?.sports) ? student.sports : []),
          ...(Array.isArray(athleteProfile.sports) ? athleteProfile.sports : []),
        ].map(normalizeScopeValue);
        const submissionSports = splitRequirementSports(submission.sport || '')
          .map(normalizeScopeValue);

        return studentSports.includes(requestedSportKey)
          && (!submissionSports.length
            || submissionSports.includes(normalizeScopeValue('General'))
            || submissionSports.includes(requestedSportKey));
      })
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
    const readySports = isScreener
      ? new Set()
      : new Set(
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
      const sportQuery = requestedSportKey ? `&sport=${encodeURIComponent(String(req.query.sport).trim())}` : '';
      const fileUrl = `/screener/requirements/${submission._id}/preview?participationType=${encodeURIComponent(submission.participationType || 'Intrams')}${sportQuery}`;
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
        screenerForwardedAt: submission.screenerForwardedAt || null,
        screenerForwardedBy: submission.screenerForwardedBy || null,
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
      const eligibleDocuments = student.requirements.documents.filter((document) => {
        if (isScreener) return Boolean(document.screenerForwardedAt);
        if (document.coachStatus !== 'approved') return false;
        const readyStudentSports = student.sports.filter((sport) => readySports.has(normalizeScopeValue(sport)));
        const documentSports = splitRequirementSports(document.sport || '')
          .map(normalizeScopeValue)
          .filter(Boolean);
        return !documentSports.length
          || documentSports.includes(normalizeScopeValue('General'))
          || documentSports.some((sport) => readyStudentSports.some((readySport) => normalizeScopeValue(readySport) === sport));
      });
      if (!eligibleDocuments.length) return [];

      const readyStudentSports = isScreener
        ? student.sports
        : student.sports.filter((sport) => readySports.has(normalizeScopeValue(sport)));
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
        sport: readyStudentSports[0] || student.sport,
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
    const primarySport = getCoachPrimarySport(coach);
    const requestedSport = String(req.query.sport || '').trim() || primarySport;
    const requestedSportKey = normalizeScopeValue(requestedSport);
    if (requestedSportKey && (
      !assignedSports.has(requestedSportKey)
      || requestedSportKey !== normalizeScopeValue(primarySport)
    )) {
      return res.status(403).json({
        success: false,
        message: 'You are not assigned to screen this sport.',
      });
    }
    if (!assignedSports.size) {
      return res.json({
        success: true,
        count: 0,
        assignedSports: [],
        selectedSport: '',
        forwardingStatus: { ready: false, forwarded: false, canForward: false },
        data: [],
      });
    }

    const galleryRoster = await getCoachGalleryRoster(coach);

    const studentsById = new Map();
    const assignedStudentIds = [];
    const eventScope = collectCoachEvents(coach);
    galleryRoster.forEach(({ student, profile }) => {
      const studentId = String(student._id);
      const studentSports = new Map([
        ...getStudentSports(student),
        ...getStudentSports(profile),
      ].map((sport) => [normalizeScopeValue(sport), String(sport || '').trim()])
        .filter(([sport, label]) => (
          sport && label && (!requestedSportKey || sport === requestedSportKey)
        )));
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
      return res.json({
        success: true,
        count: 0,
        forwardingStatus: { ready: false, forwarded: false, canForward: false },
        assignedSports: collectCoachSportLabels(coach),
        selectedSport: requestedSport,
        data: [],
      });
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
          { requirementStatus: 'active' },
          { studentId: { $in: assignedStudentIds } },
        ],
      })
        .select('studentId requirementType participationType customRequirementId customRequirementLabel requirementStatus fileName fileType fileSize filePath files.fileName files.fileType files.fileSize files.filePath status coachStatus coachRemarks screenerForwardedAt screenerForwardedBy resubmitted uploadDate createdAt remarks sport')
        .sort({ uploadDate: -1, _id: -1 })
        .lean()
        .then((eventSubmissions) => eventSubmissions.filter(isActiveRequirement).map((submission) => ({
          ...submission,
          participationType: submission.participationType || participationType,
        })));
    }));

    const submissions = submissionsByEvent.flat();
    // Exclude submissions linked to archived or inactive Requirement templates.
    // Built-in types (med, psa, cor, insurance, profile, consent) have no parent
    // template and are always included. Only custom other-type submissions are
    // cross-referenced against the Requirement template status.
    const getCustomIds = [...new Set(
      submissions
        .filter((s) => String(s.requirementType || '').toLowerCase() === 'other' && s.customRequirementId)
        .map((s) => s.customRequirementId)
    )];
    let getActiveTemplateIds = new Set();
    if (getCustomIds.length) {
      const getActiveTemplates = await Requirement.find({
        _id: { $in: getCustomIds },
        status: { $in: ['published'] },
        isActive: { $ne: false },
      }).select('_id').lean();
      getActiveTemplateIds = new Set(getActiveTemplates.map((t) => String(t._id)));
    }
    const activeSubmissions = submissions.filter((s) => {
      if (String(s.requirementType || '').toLowerCase() !== 'other') return true;
      if (!s.customRequirementId) return true;
      return getActiveTemplateIds.has(String(s.customRequirementId));
    });

    const inScopeSubmissions = activeSubmissions.filter((submission) => {
      const participationType = submission.participationType || 'Intrams';
      if (eventScope.size && !eventScope.has(normalizeScopeValue(participationType))) return false;

      const studentId = String(submission.studentId?._id || submission.studentId || '');
      const matchedStudent = studentsById.get(studentId);
      if (!matchedStudent) return false;

      const submissionSports = splitRequirementSports(submission.sport || '')
        .map(normalizeScopeValue)
        .filter(Boolean);
      if (submissionSports.length && !submissionSports.includes(normalizeScopeValue('General'))
        && !submissionSports.some((sport) => assignedSports.has(sport)
          && matchedStudent.matchedSports.some((matchedSport) => normalizeScopeValue(matchedSport) === sport))) {
        return false;
      }

      return true;
    });

    inScopeSubmissions.forEach((submission) => {
      const participationType = submission.participationType || 'Intrams';
      const studentId = String(submission.studentId?._id || submission.studentId || '');
      const matchedStudent = studentsById.get(studentId);
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
        screenerForwardedAt: submission.screenerForwardedAt || null,
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
    const forwardingReadiness = getCoachForwardingReadiness(roster, inScopeSubmissions, eventScope);
    const data = roster.map(({ entry }) => entry);
    const forwardingComplete = forwardingReadiness.submissions.length > 0
      && forwardingReadiness.submissions.every((submission) => Boolean(submission.screenerForwardedAt));

    return res.json({
      success: true,
      count: data.length,
      assignedSports: collectCoachSportLabels(coach),
      selectedSport: requestedSport,
      forwardingStatus: {
        ready: forwardingReadiness.ready,
        forwarded: forwardingComplete,
        canForward: forwardingReadiness.ready,
      },
      data,
    });
  } catch (error) {
    console.error('Coach requirements error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to load coach requirements.',
    });
  }
});

router.post('/coach/requirements/forward', protect, authorize('coach'), async (req, res) => {
  let session;
  try {
    const coachId = req.user?._id || req.user?.id;
    const coach = coachId ? await findCoachAccount(coachId) : null;
    if (String(req.user?.role || '').toLowerCase() !== 'coach' || !coach || coach.role !== 'coach') {
      return res.status(403).json({ success: false, message: 'Coach access could not be verified.' });
    }

    const selectedSport = String(req.body?.sport || '').trim()
      || getCoachPrimarySport(coach);
    const primarySport = getCoachPrimarySport(coach);
    if (!selectedSport) {
      return res.status(400).json({
        success: false,
        message: 'A primary assigned sport is required before forwarding.',
      });
    }
    if (normalizeScopeValue(selectedSport) !== normalizeScopeValue(primarySport)
      || !collectCoachSports(coach).has(normalizeScopeValue(selectedSport))) {
      return res.status(403).json({
        success: false,
        message: 'You are not assigned to screen this sport.',
      });
    }

    const forwardingContext = await getCoachForwardingContext(coach, selectedSport);
    if (!forwardingContext.ready || forwardingContext.submissions.length === 0) {
      return res.status(409).json({
        success: false,
        message: `You cannot forward these documents to the Screener yet. Please complete the initial screening of all active requirements for every student-athlete in ${selectedSport} before forwarding.`,
      });
    }

    const submissionsToForward = forwardingContext.submissions
      .filter((submission) => !submission.screenerForwardedAt);
    if (submissionsToForward.length === 0) {
      return res.status(409).json({
        success: false,
        message: 'These documents have already been forwarded to the Screener.',
      });
    }

    const forwardedAt = new Date();
    const forwardedBy = coach._id || coachId;
    const submissionsByModel = new Map();
    submissionsToForward.forEach((submission) => {
      const RequirementModel = getStudentRequirementModel(submission.participationType);
      if (!submissionsByModel.has(RequirementModel)) submissionsByModel.set(RequirementModel, []);
      submissionsByModel.get(RequirementModel).push(submission._id);
    });

    session = await mongoose.startSession();
    await session.withTransaction(async () => {
      for (const [RequirementModel, submissionIds] of submissionsByModel) {
        const result = await RequirementModel.updateMany(
          {
            _id: { $in: submissionIds },
            coachStatus: 'approved',
            requirementStatus: 'active',
            screenerForwardedAt: null,
          },
          {
            $set: { screenerForwardedAt: forwardedAt, screenerForwardedBy: forwardedBy },
          },
          { session }
        );
        if (result.modifiedCount !== submissionIds.length) {
          const error = new Error('Coach screening changed while forwarding. Reload the requirements and try again.');
          error.statusCode = 409;
          throw error;
        }
      }
    });

    return res.json({
      success: true,
      message: 'Documents forwarded to the Screener successfully.',
      forwardedAt,
      forwardedCount: submissionsToForward.length,
    });
  } catch (error) {
    if (error.statusCode === 409) {
      return res.status(409).json({ success: false, message: error.message });
    }
    console.error('Coach requirement forwarding error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to forward these documents to the Screener.',
    });
  } finally {
    if (session) await session.endSession();
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
    if (await denyScreenerSportMismatch(req, res, submission, req.body?.sport)) return;
    if (denyUnforwardedScreenerSubmission(req, res, submission)) return;

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
    if (await denyScreenerSportMismatch(req, res, submission, req.body?.sport)) return;
    if (String(req.user?.role || '').toLowerCase() === 'screener' && submission.coachStatus !== 'approved') {
      return res.status(409).json({
        success: false,
        message: 'This requirement is not available until its sport group is approved by the coach.'
      });
    }
    if (denyUnforwardedScreenerSubmission(req, res, submission)) return;

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
    if (['approved', 'rejected'].includes(normalizedStatus)) {
      submission.notificationReadAt = null;
    }
    if (normalizedStatus === 'rejected') {
      submission.status = 'rejected';
      submission.remarks = submission.coachRemarks;
      submission.reviewedAt = submission.coachReviewedAt;
      submission.reviewedBy = submission.coachReviewedBy;
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