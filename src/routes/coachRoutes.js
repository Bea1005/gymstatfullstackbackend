const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const router = express.Router();
const User = require('../models/User');
const StudentAthlete = require('../models/StudentAthlete');
const StudentProfile = require('../models/StudentProfile');
const StrasucFacultyMember = require('../models/StrasucFacultyMember');
const { streamProfilePhoto } = require('../config/profilePhotoStorage');
const { uploadProfilePhoto, deleteProfilePhoto } = require('../config/profilePhotoStorage');
const { protect, authorize } = require('../middleware/auth');

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getCoachAccess = async (coachId) => {
  const coach = await User.findOne({ _id: coachId, role: 'coach' })
    .select('_id')
    .lean();
  return coach;
};

const studentProjection = '_id id fullname department yearLevel branchCampus dateOfBirth dob sport assignedSports sportParticipation athleteStatus';
const studentSearchProjection = '_id id studentNumber fullname department yearLevel branchCampus dateOfBirth dob sport assignedSports sportParticipation athleteStatus';
const studentAthleteSearchProjection = 'userId id studentNumber fullname department yearLevel branchCampus dateOfBirth dob sport sportParticipation athleteStatus updatedAt';

const getStudentSportForCategory = (student, category) => {
  const normalizedCategory = String(category || '').trim().toLowerCase();
  const savedSports = [
    student.sport,
    ...(Array.isArray(student.assignedSports) ? student.assignedSports : []),
    ...(Array.isArray(student.sportParticipation) ? student.sportParticipation.map((entry) => entry?.sport) : []),
  ];
  return savedSports.find((sport) => String(sport || '').trim().toLowerCase() === normalizedCategory) || '';
};

const mergeStudentRecords = (user, studentAthlete = {}) => ({
  ...studentAthlete,
  ...user,
  _id: user._id,
  id: user.id || studentAthlete.id || String(user._id),
  fullname: user.fullname || studentAthlete.fullname || '',
  department: user.department || studentAthlete.department || '',
  yearLevel: user.yearLevel || studentAthlete.yearLevel || '',
  branchCampus: user.branchCampus || studentAthlete.branchCampus || '',
  dateOfBirth: user.dateOfBirth || studentAthlete.dateOfBirth || '',
  dob: user.dob || studentAthlete.dob || '',
  sport: user.sport || studentAthlete.sport || '',
  assignedSports: [...new Set([
    ...(Array.isArray(user.assignedSports) ? user.assignedSports : []),
    ...(Array.isArray(studentAthlete.assignedSports) ? studentAthlete.assignedSports : []),
  ])],
  sportParticipation: user.sportParticipation?.length
    ? user.sportParticipation
    : (studentAthlete.sportParticipation || []),
  athleteStatus: user.athleteStatus || studentAthlete.athleteStatus || '',
});

const findStudentAthleteRecords = async (students) => {
  const userIds = students.map((student) => student._id).filter(Boolean);
  const registeredIds = students.map((student) => student.id).filter(Boolean);
  const studentNumbers = students.map((student) => student.studentNumber).filter(Boolean);
  if (!userIds.length && !registeredIds.length && !studentNumbers.length) return [];

  const links = [];
  if (userIds.length) links.push({ userId: { $in: userIds } });
  if (registeredIds.length) links.push({ id: { $in: registeredIds } });
  if (studentNumbers.length) links.push({ studentNumber: { $in: studentNumbers } });

  return StudentAthlete.find({ $or: links })
    .select(studentAthleteSearchProjection)
    .sort({ updatedAt: -1 })
    .lean();
};

const linkStudentAthletesToUsers = (users, studentAthletes) => {
  const usersById = new Map(users.map((user) => [String(user._id), user]));
  const usersByRegisteredId = new Map(users.filter((user) => user.id).map((user) => [String(user.id), user]));
  const usersByStudentNumber = new Map(users.filter((user) => user.studentNumber).map((user) => [String(user.studentNumber), user]));
  const profilesByUserId = new Map();

  for (const studentAthlete of studentAthletes) {
    const user = usersById.get(String(studentAthlete.userId || ''))
      || usersByRegisteredId.get(String(studentAthlete.id || ''))
      || usersByStudentNumber.get(String(studentAthlete.studentNumber || ''));
    if (user && !profilesByUserId.has(String(user._id))) {
      profilesByUserId.set(String(user._id), studentAthlete);
    }
  }

  return users.map((user) => mergeStudentRecords(user, profilesByUserId.get(String(user._id))));
};

const getStudentSearchIdentifiers = (student) => [
  student.id,
  student.studentNumber,
  student.studentAthleteId,
].map((value) => String(value || '').toLowerCase()).filter(Boolean);

const toStudentResponse = (student, profile, selectedSport) => ({
  _id: student._id,
  id: student.id || String(student._id),
  studentId: String(student._id),
  fullname: student.fullname || '',
  department: student.department || '',
  yearLevel: student.yearLevel || '',
  dateOfBirth: student.dateOfBirth || student.dob || '',
  dob: student.dob || student.dateOfBirth || '',
  sport: getStudentSportForCategory(student, selectedSport) || student.sport || '',
  branchCampus: student.branchCampus || '',
  athleteStatus: student.athleteStatus || '',
  profilePhotoUrl: profile?.imageFileId ? `/coach/students/${student._id}/profile-photo` : '',
});

const facultyPhotoUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, callback) => callback(null, ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.mimetype)),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const getFacultyResponse = (member) => ({
  id: member.facultyId,
  facultyId: member.facultyId,
  role: member.role,
  fullname: member.name,
  name: member.name,
  age: member.age,
  phone: member.contactNumber,
  contactNumber: member.contactNumber,
  email: member.email,
  profilePhotoUrl: member.imageFileId ? `/coach/faculty-members/${member.facultyId}/profile-photo` : '',
  createdAt: member.createdAt,
  updatedAt: member.updatedAt,
});

const findFacultyMember = (coachId, facultyId) => StrasucFacultyMember.findOne({ coachId, facultyId });

router.get('/coach/faculty-members', protect, authorize('coach'), async (req, res) => {
  try {
    let members = await StrasucFacultyMember.find({ coachId: req.user._id }).sort({ createdAt: 1 });
    if (members.length === 0) {
      const coach = await User.findById(req.user._id).select('staffMembers').lean();
      const legacyMembers = Array.isArray(coach?.staffMembers)
        ? coach.staffMembers.filter((member) => member?.fullname || member?.phone || member?.email)
        : [];
      if (legacyMembers.length > 0) {
        await StrasucFacultyMember.insertMany(legacyMembers.map((member) => ({
          facultyId: crypto.randomUUID(),
          coachId: req.user._id,
          role: member.role || 'OTHER FACULTY',
          name: member.fullname || 'Faculty Member',
          age: member.age || '',
          contactNumber: member.phone || '',
          email: member.email || '',
        })));
        members = await StrasucFacultyMember.find({ coachId: req.user._id }).sort({ createdAt: 1 });
      }
    }
    return res.json(members.map(getFacultyResponse));
  } catch (error) {
    console.error('Faculty members fetch error:', error);
    return res.status(500).json({ message: 'Server error while fetching faculty members' });
  }
});

router.post('/coach/faculty-members', protect, authorize('coach'), facultyPhotoUpload.single('profilePhoto'), async (req, res) => {
  let newFileId = null;
  try {
    const { facultyId = crypto.randomUUID(), role, name, fullname, age, contactNumber, phone, email } = req.body;
    const facultyName = String(name || fullname || '').trim();
    if (!facultyName) return res.status(400).json({ message: 'Faculty member name is required' });
    if (await StrasucFacultyMember.exists({ facultyId })) return res.status(409).json({ message: 'Faculty member already exists' });

    if (req.file) {
      newFileId = await uploadProfilePhoto({
        buffer: req.file.buffer,
        filename: req.file.originalname,
        contentType: req.file.mimetype,
        studentId: req.user._id,
        purpose: 'strasuc-faculty-member-photo',
      });
    }

    const member = await StrasucFacultyMember.create({
      facultyId,
      coachId: req.user._id,
      role: role || 'OTHER FACULTY',
      name: facultyName,
      age: age || '',
      contactNumber: contactNumber || phone || '',
      email: email || '',
      imageFileId: newFileId,
      imageFilename: req.file?.originalname || '',
      imageMimeType: req.file?.mimetype || '',
      storageReference: newFileId ? `gridfs://${newFileId.toString()}` : '',
    });
    return res.status(201).json(getFacultyResponse(member));
  } catch (error) {
    if (newFileId) await deleteProfilePhoto(newFileId).catch(() => {});
    console.error('Faculty member create error:', error);
    return res.status(500).json({ message: 'Server error while creating faculty member' });
  }
});

router.put('/coach/faculty-members/:facultyId', protect, authorize('coach'), facultyPhotoUpload.single('profilePhoto'), async (req, res) => {
  let newFileId = null;
  try {
    const member = await findFacultyMember(req.user._id, req.params.facultyId);
    if (!member) return res.status(404).json({ message: 'Faculty member not found' });
    const oldFileId = member.imageFileId;
    if (req.file) {
      newFileId = await uploadProfilePhoto({
        buffer: req.file.buffer,
        filename: req.file.originalname,
        contentType: req.file.mimetype,
        studentId: req.user._id,
        purpose: 'strasuc-faculty-member-photo',
      });
    }

    const { role, name, fullname, age, contactNumber, phone, email } = req.body;
    if (role !== undefined) member.role = role;
    if (name !== undefined || fullname !== undefined) member.name = String(name || fullname).trim();
    if (age !== undefined) member.age = age;
    if (contactNumber !== undefined || phone !== undefined) member.contactNumber = contactNumber || phone;
    if (email !== undefined) member.email = email;
    if (newFileId) {
      member.imageFileId = newFileId;
      member.imageFilename = req.file.originalname;
      member.imageMimeType = req.file.mimetype;
      member.storageReference = `gridfs://${newFileId.toString()}`;
    }
    await member.save();
    if (newFileId && oldFileId) {
      await deleteProfilePhoto(oldFileId).catch((cleanupError) => {
        console.error('Unable to delete replaced faculty photo:', cleanupError);
      });
    }
    return res.json(getFacultyResponse(member));
  } catch (error) {
    if (newFileId) await deleteProfilePhoto(newFileId).catch(() => {});
    console.error('Faculty member update error:', error);
    return res.status(500).json({ message: 'Server error while updating faculty member' });
  }
});

router.get('/coach/faculty-members/:facultyId/profile-photo', protect, authorize('coach'), async (req, res) => {
  try {
    const member = await findFacultyMember(req.user._id, req.params.facultyId);
    if (!member?.imageFileId) return res.status(404).json({ message: 'Faculty profile photo not found' });
    res.setHeader('Content-Type', member.imageMimeType);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'no-store');
    await streamProfilePhoto(member.imageFileId, res);
  } catch (error) {
    console.error('Faculty profile photo error:', error);
    if (!res.headersSent) return res.status(404).json({ message: 'Faculty profile photo not found' });
  }
});

router.delete('/coach/faculty-members/:facultyId', protect, authorize('coach'), async (req, res) => {
  try {
    const member = await findFacultyMember(req.user._id, req.params.facultyId);
    if (!member) return res.status(404).json({ message: 'Faculty member not found' });
    await member.deleteOne();
    if (member.imageFileId) await deleteProfilePhoto(member.imageFileId);
    return res.json({ success: true });
  } catch (error) {
    console.error('Faculty member delete error:', error);
    return res.status(500).json({ message: 'Server error while deleting faculty member' });
  }
});

router.get('/coach/students/:studentId/profile-photo', protect, authorize('coach'), async (req, res) => {
  try {
    const coach = await User.findOne({
      _id: req.user._id,
      role: 'coach',
      strasucStudentIds: req.params.studentId,
    }).select('_id').lean();
    if (!coach) return res.status(403).json({ message: 'You are not authorized to view this student' });

    const student = await User.findOne({ _id: req.params.studentId, role: 'student' }).select('_id').lean();
    const profile = student ? await StudentProfile.findOne({ studentId: student._id }).lean() : null;
    if (!profile?.imageFileId) return res.status(404).json({ message: 'Profile photo not found' });

    res.setHeader('Content-Type', profile.mimeType);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'no-store');
    await streamProfilePhoto(profile.imageFileId, res);
  } catch (error) {
    console.error('Coach student profile photo error:', error);
    return res.status(500).json({ message: 'Unable to load student profile photo' });
  }
});

// GET coach profile
router.get('/coach/profile', protect, authorize('coach'), async (req, res) => {
  try {
    const user = await User.findById(req.user._id || req.user.id).select('-password');

    if (!user) {
      return res.status(404).json({ message: 'Coach not found' });
    }

    return res.json({
      fullname: user.fullname,
      email: user.email,
      mainSport: user.sport || '',
      position: user.coachPosition || 'Coach',
      sportParticipation: user.sportParticipation || [],
      staffMembers: user.staffMembers || []
    });
  } catch (error) {
    console.error('Coach profile error:', error);
    return res.status(500).json({ message: 'Server error while fetching coach profile' });
  }
});

// PUT coach profile updates (sport participation only)
router.put('/coach/profile', protect, authorize('coach'), async (req, res) => {
  try {
    const { sportParticipation, coachPosition, staffMembers } = req.body;

    const user = await User.findById(req.user._id || req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'Coach not found' });
    }

    user.sportParticipation = Array.isArray(sportParticipation) ? sportParticipation : user.sportParticipation;
    if (typeof coachPosition === 'string' && ['Coach', 'Assistant Coach', 'Trainer'].includes(coachPosition)) {
      user.coachPosition = coachPosition;
    }
    if (Array.isArray(staffMembers)) {
      user.staffMembers = staffMembers;
    }
    await user.save();

    return res.json({ success: true, message: 'Coach profile updated successfully' });
  } catch (error) {
    console.error('Coach profile update error:', error);
    return res.status(500).json({ message: 'Server error while updating coach profile' });
  }
});

// GET coach athletes (assigned students)
router.get('/coach/athletes', protect, authorize('coach'), async (req, res) => {
  try {
    const selectedSport = String(req.query.sport || req.user?.sport || '').trim();
    const coach = await User.findOne({ _id: req.user._id || req.user.id, role: 'coach' })
      .select('strasucStudentIds')
      .lean();
    const selectedStudentIds = Array.isArray(coach?.strasucStudentIds) ? coach.strasucStudentIds : [];
    const filter = { role: 'student', _id: { $in: selectedStudentIds } };

    const athletes = await User.find(filter).select(studentProjection).lean();
    const athletesNeedingRoleProfile = athletes.filter((athlete) => !getStudentSportForCategory(athlete, selectedSport));
    const roleProfiles = await findStudentAthleteRecords(athletesNeedingRoleProfile);
    const normalizedAthletes = linkStudentAthletesToUsers(athletes, roleProfiles);
    const sportMatchedAthletes = normalizedAthletes.filter((athlete) => (
      !selectedSport || getStudentSportForCategory(athlete, selectedSport)
    ));
    const studentIds = sportMatchedAthletes.map((athlete) => athlete._id);
    const profiles = studentIds.length > 0
      ? await StudentProfile.find({ studentId: { $in: studentIds } }).select('studentId imageFileId').lean()
      : [];
    const profilesByStudentId = new Map(profiles.map((profile) => [String(profile.studentId), profile]));

    return res.json(sportMatchedAthletes.map((athlete) => {
      const studentProfile = profilesByStudentId.get(String(athlete._id));
      return toStudentResponse(athlete, studentProfile, selectedSport);
    }));
  } catch (error) {
    console.error('Coach athletes error:', error);
    return res.status(500).json({ message: 'Server error while fetching coach athletes' });
  }
});

// Create a student profile from the Coach Records page.
router.post('/coach/athletes', protect, authorize('coach'), async (req, res) => {
  try {
    const { studentId } = req.body;
    const selectedSport = String(req.body?.sport || '').trim();
    if (!studentId || !selectedSport) {
      return res.status(400).json({ message: 'An existing student and sport category must be selected' });
    }

    const access = await getCoachAccess(req.user._id || req.user.id);
    if (!access) return res.status(403).json({ message: 'Coach access could not be verified' });

    const userStudent = await User.findOne({
      _id: studentId,
      role: 'student',
      accountStatus: { $ne: 'archived' },
    }).select(studentSearchProjection).lean();
    if (!userStudent) return res.status(404).json({ message: 'Student not found' });

    let student = userStudent;
    if (!getStudentSportForCategory(userStudent, selectedSport)) {
      const profile = await StudentAthlete.findOne({
        $or: [
          { userId: userStudent._id },
          { id: userStudent.id },
          ...(userStudent.studentNumber ? [{ studentNumber: userStudent.studentNumber }] : []),
        ],
      }).select(studentAthleteSearchProjection).lean();
      if (profile) student = mergeStudentRecords(userStudent, profile);
    }
    if (!getStudentSportForCategory(student, selectedSport)) {
      return res.status(404).json({ message: 'Student not found for the selected sport' });
    }

    await User.updateOne(
      { _id: req.user._id || req.user.id },
      { $addToSet: { strasucStudentIds: student._id } }
    );
    const profile = await StudentProfile.findOne({ studentId: student._id }).select('imageFileId').lean();
    return res.status(200).json({ success: true, data: toStudentResponse(student, profile, selectedSport) });
  } catch (error) {
    console.error('Coach athlete create error:', error);
    return res.status(500).json({ message: 'Server error while creating student profile' });
  }
});

// Update an assigned student profile
router.put('/coach/athletes/:studentId', protect, authorize('coach'), async (req, res) => {
  try {
    const { fullname, email, department, course, yearLevel, dateOfBirth, dob, branchCampus, location, profilePhoto, photo, sport, status, athleteStatus } = req.body;
    const student = await User.findOne({ _id: req.params.studentId, role: 'student' });

    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    const coachId = req.user?._id || req.user?.id;
    const coachAssignment = await User.findOne({
      _id: coachId,
      role: 'coach',
      strasucStudentIds: student._id,
    }).select('_id').lean();

    if (!coachAssignment) {
      return res.status(403).json({ message: 'You are not authorized to update this student' });
    }

    if (typeof fullname === 'string') student.fullname = fullname;
    if (typeof email === 'string') student.email = email;
    if (typeof department === 'string') student.department = department;
    if (typeof course === 'string') {
      const courseParts = course.trim().match(/^(.*?)(?:\s+-\s+([IVX]+))?$/);
      student.department = courseParts?.[1] || '';
      if (courseParts?.[2] && ['I', 'II', 'III', 'IV'].includes(courseParts[2])) student.yearLevel = courseParts[2];
    }
    if (typeof yearLevel === 'string') student.yearLevel = yearLevel;
    if (typeof dateOfBirth === 'string' || typeof dob === 'string') student.dateOfBirth = dateOfBirth || dob;
    const requestedCampus = branchCampus ?? location;
    if (typeof requestedCampus === 'string' && requestedCampus !== student.branchCampus) {
      const allowedCampuses = User.schema.path('branchCampus')?.enumValues || [];
      if (!allowedCampuses.includes(requestedCampus)) {
        return res.status(400).json({ message: 'Please select a supported school campus' });
      }
      student.branchCampus = requestedCampus;
    }
    if (typeof profilePhoto === 'string' || typeof photo === 'string') student.profilePhoto = profilePhoto || photo;
    if (typeof sport === 'string') student.sport = sport;
    if (typeof athleteStatus === 'string' || typeof status === 'string') student.athleteStatus = athleteStatus || status;

    await student.save();

    return res.json({ success: true, message: 'Student profile updated successfully' });
  } catch (error) {
    console.error('Coach athlete update error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: 'Some student profile fields are invalid. Please review them and try again.' });
    }
    return res.status(500).json({ message: 'Server error while updating student profile' });
  }
});

// Get existing students that can be added to the coach's sport.
router.get('/coach/student-search', protect, authorize('coach'), async (req, res) => {
  try {
    const query = String(req.query.q || '').trim();
    const selectedSport = String(req.query.sport || '').trim();
    if (!selectedSport) return res.json([]);

    const access = await getCoachAccess(req.user._id || req.user.id);
    if (!access) return res.status(403).json({ message: 'Coach access could not be verified' });

    const queryMatcher = { $regex: escapeRegex(query), $options: 'i' };
    const sportMatcher = { $regex: `^${escapeRegex(selectedSport)}$`, $options: 'i' };
    const sportConditions = [
      { sport: sportMatcher },
      { assignedSports: sportMatcher },
      { 'sportParticipation.sport': sportMatcher },
    ];
    const userFilter = {
      role: 'student',
      accountStatus: { $ne: 'archived' },
      $and: [{ $or: sportConditions }],
    };
    const studentAthleteFilter = {
      role: 'student',
      sport: sportMatcher,
    };
    if (query) {
      const textConditions = [
        { id: queryMatcher },
        { studentNumber: queryMatcher },
        { fullname: queryMatcher },
      ];
      userFilter.$and.push({ $or: textConditions });
      studentAthleteFilter.$or = textConditions;
    }

    const [userCandidates, studentAthleteCandidates] = await Promise.all([
      User.find(userFilter)
        .select(studentSearchProjection)
        .sort({ fullname: 1 })
        .limit(200)
        .lean(),
      StudentAthlete.find(studentAthleteFilter)
        .select(studentAthleteSearchProjection)
        .sort({ fullname: 1 })
        .limit(200)
        .lean(),
    ]);

    const linkClauses = [];
    const linkedUserIds = studentAthleteCandidates.map((student) => student.userId).filter(Boolean);
    const linkedRegisteredIds = studentAthleteCandidates.map((student) => student.id).filter(Boolean);
    const linkedStudentNumbers = studentAthleteCandidates.map((student) => student.studentNumber).filter(Boolean);
    if (linkedUserIds.length) linkClauses.push({ _id: { $in: linkedUserIds } });
    if (linkedRegisteredIds.length) linkClauses.push({ id: { $in: linkedRegisteredIds } });
    if (linkedStudentNumbers.length) {
      linkClauses.push({ studentNumber: { $in: linkedStudentNumbers } });
      linkClauses.push({ id: { $in: linkedStudentNumbers } });
    }

    const linkedUsers = linkClauses.length
      ? await User.find({
          role: 'student',
          accountStatus: { $ne: 'archived' },
          $or: linkClauses,
        })
          .select(studentSearchProjection)
          .lean()
      : [];
    const candidatesByUserId = new Map(
      [...userCandidates, ...linkedUsers].map((student) => [String(student._id), student])
    );
    const reconciledProfiles = await findStudentAthleteRecords([...candidatesByUserId.values()]);
    const students = linkStudentAthletesToUsers(
      [...candidatesByUserId.values()],
      [...studentAthleteCandidates, ...reconciledProfiles]
    );
    const normalizedQuery = query.toLowerCase();
    const matchingStudents = students
      .filter((student) => getStudentSportForCategory(student, selectedSport))
      .filter((student) => !normalizedQuery
        || getStudentSearchIdentifiers({
          ...student,
          studentAthleteId: reconciledProfiles.find((profile) => (
            String(profile.userId || '') === String(student._id)
            || String(profile.id || '') === String(student.id || '')
          ))?.id,
        }).some((identifier) => identifier.includes(normalizedQuery))
        || String(student.fullname || '').toLowerCase().includes(normalizedQuery))
      .sort((left, right) => String(left.fullname || '').localeCompare(String(right.fullname || '')))
      .slice(0, 100);

    return res.json(matchingStudents.map((student) => ({
      _id: student._id,
      id: student.id || String(student._id),
      fullname: student.fullname || '',
      sport: getStudentSportForCategory(student, selectedSport) || student.sport || '',
    })));
  } catch (err) {
    console.error('Coach student search error:', err);
    return res.status(500).json({ message: 'Server error while searching students' });
  }
});

router.get('/coach/student-directory', protect, authorize('coach'), async (req, res) => {
  try {
    const coach = await User.findOne({ _id: req.user._id || req.user.id, role: 'coach' })
      .select('strasucStudentIds')
      .lean();
    if (!coach) return res.status(403).json({ message: 'Coach access could not be verified' });

    const students = await User.find({ role: 'student', _id: { $in: coach.strasucStudentIds || [] } })
      .select(studentProjection)
      .lean();
    const profiles = await StudentProfile.find({ studentId: { $in: students.map((student) => student._id) } })
      .select('studentId imageFileId')
      .lean();
    const profilesByStudentId = new Map(profiles.map((profile) => [String(profile.studentId), profile]));
    return res.json(students.map((student) => toStudentResponse(student, profilesByStudentId.get(String(student._id)))));
  } catch (error) {
    console.error('Coach student directory error:', error);
    return res.status(500).json({ message: 'Server error while fetching students' });
  }
});

router.delete('/coach/athletes/:studentId', protect, authorize('coach'), async (req, res) => {
  try {
    const result = await User.updateOne(
      { _id: req.user._id || req.user.id },
      { $pull: { strasucStudentIds: req.params.studentId } }
    );
    if (!result.matchedCount) return res.status(404).json({ message: 'Coach not found' });
    return res.json({ success: true, message: 'Student removed from the gallery successfully' });
  } catch (error) {
    console.error('Coach athlete delete error:', error);
    return res.status(500).json({ message: 'Server error while deleting student profile' });
  }
});

// GET coach updates / announcements
router.get('/coach/updates', protect, authorize('coach'), async (req, res) => {
  try {
    const updates = [
      {
        id: 1,
        title: 'Team 1 Basketball Team Training',
        date: 'January 23, 2026',
        time: '8AM - 10AM',
        description: 'Reminder to finalize participant attendance and equipment requirements before training.',
        type: 'coach-update',
      },
      {
        id: 2,
        title: 'Intramural Requirements 2026',
        date: 'January 14, 2026',
        time: 'All Day',
        description: 'Sport requirements for the upcoming intramural season are now available for review.',
        type: 'requirement',
      },
      {
        id: 3,
        title: 'Coach Meeting Schedule',
        date: 'January 28, 2026',
        time: '2:30PM',
        description: 'Please confirm attendance for the weekly department meeting and submit any updates.',
        type: 'coach-update',
      }
    ];
    return res.json(updates);
  } catch (error) {
    console.error('Coach updates error:', error);
    return res.status(500).json({ message: 'Server error while fetching coach updates' });
  }
});

module.exports = router;
