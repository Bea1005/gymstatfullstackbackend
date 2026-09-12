const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const router = express.Router();
const User = require('../models/User');
const StudentProfile = require('../models/StudentProfile');
const StrasucFacultyMember = require('../models/StrasucFacultyMember');
const { streamProfilePhoto } = require('../config/profilePhotoStorage');
const { uploadProfilePhoto, deleteProfilePhoto } = require('../config/profilePhotoStorage');
const StudentRequirement = require('../models/StudentRequirement');
const { protect, authorize } = require('../middleware/auth');

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

const REQUIRED_REQUIREMENT_TYPES = ['medical', 'cor', 'psa', 'insurance', 'profile', 'consent'];

const getRequirementLabel = (type) => {
  const labels = {
    medical: 'Medical Certificate',
    cor: 'Certificate of Registration',
    psa: 'PSA',
    insurance: 'Insurance',
    profile: 'Student Profile',
    consent: 'Parent Consent',
  };
  return labels[type] || type;
};

const getStudentRequirementsEligibility = async (studentId) => {
  const submissions = await StudentRequirement.find({ studentId }).sort({ uploadDate: -1 }).lean();
  const latestByType = new Map();

  for (const submission of submissions) {
    const normalizedType = String(submission.requirementType || '').trim().toLowerCase();
    if (!REQUIRED_REQUIREMENT_TYPES.includes(normalizedType) || latestByType.has(normalizedType)) continue;
    latestByType.set(normalizedType, submission);
  }

  const missing = [];
  const incomplete = [];

  for (const type of REQUIRED_REQUIREMENT_TYPES) {
    const latest = latestByType.get(type);
    if (!latest) {
      missing.push(getRequirementLabel(type));
      continue;
    }

    if (String(latest.status || '').toLowerCase() !== 'approved') {
      incomplete.push(getRequirementLabel(type));
    }
  }

  return {
    eligible: missing.length === 0 && incomplete.length === 0,
    missing,
    incomplete,
  };
};

router.get('/coach/students/:studentId/profile-photo', protect, authorize('coach'), async (req, res) => {
  try {
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
      mainSport: user.sport || 'Basketball',
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
    const filter = { role: 'student' };
    if (selectedSport) {
      filter.$or = [
        { sport: selectedSport },
        { 'sportParticipation.sport': selectedSport },
      ];
    }

    const athletes = await User.find(filter).select('-password').lean();
    const eligibleAthletes = [];

    for (const athlete of athletes) {
      const eligibility = await getStudentRequirementsEligibility(athlete._id);
      if (eligibility.eligible) {
        eligibleAthletes.push({
          _id: athlete._id,
          id: athlete.id || athlete._id,
          fullname: athlete.fullname || '',
          email: athlete.email || '',
          department: athlete.department || '',
          yearLevel: athlete.yearLevel || '',
          dateOfBirth: athlete.dateOfBirth || athlete.dob || '',
          dob: athlete.dob || athlete.dateOfBirth || '',
          athleteStatus: athlete.athleteStatus || '',
          branchCampus: athlete.branchCampus || '',
          profilePhoto: '',
          profilePhotoUrl: `/coach/students/${athlete._id}/profile-photo`,
          sport: athlete.sport || '',
          createdAt: athlete.createdAt,
          updatedAt: athlete.updatedAt,
        });
      }
    }

    return res.json(eligibleAthletes);
  } catch (error) {
    console.error('Coach athletes error:', error);
    return res.status(500).json({ message: 'Server error while fetching coach athletes' });
  }
});

// Create a student profile from the Coach Records page.
router.post('/coach/athletes', protect, authorize('coach'), async (req, res) => {
  try {
    const { studentId, sport } = req.body;
    if (!studentId) {
      return res.status(400).json({ message: 'An existing student must be selected' });
    }

    const student = await User.findOne({ _id: studentId, role: 'student' });
    if (!student) return res.status(404).json({ message: 'Student not found' });

    const eligibility = await getStudentRequirementsEligibility(student._id);
    if (!eligibility.eligible) {
      return res.status(400).json({
        message: 'This student-athlete cannot be added yet because their requirements are not complete.',
        eligibility,
      });
    }

    student.sport = sport || req.user?.sport || student.sport || '';
    await student.save();
    return res.status(200).json({ success: true, data: student.toObject() });
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

    if (req.user?.sport && student.sport && student.sport !== req.user.sport) {
      return res.status(403).json({ message: 'This student is not assigned to your sport' });
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
    if (typeof branchCampus === 'string' || typeof location === 'string') student.branchCampus = branchCampus || location;
    if (typeof profilePhoto === 'string' || typeof photo === 'string') student.profilePhoto = profilePhoto || photo;
    if (typeof sport === 'string') student.sport = sport;
    if (typeof athleteStatus === 'string' || typeof status === 'string') student.athleteStatus = athleteStatus || status;

    await student.save();

    return res.json({ success: true, message: 'Student profile updated successfully' });
  } catch (error) {
    console.error('Coach athlete update error:', error);
    return res.status(500).json({ message: 'Server error while updating student profile' });
  }
});

// Get existing students that can be added to the coach's sport.
router.get('/coach/student-directory', protect, authorize('coach'), async (req, res) => {
  try {
    const students = await User.find({ role: 'student' }).select('-password').lean();
    const eligibleStudents = [];

    for (const student of students) {
      const eligibility = await getStudentRequirementsEligibility(student._id);
      if (eligibility.eligible) {
        eligibleStudents.push({
          ...student,
          id: student.id || student._id,
          studentId: student.id || student.studentId || student._id,
          username: student.username || '',
          profilePhotoUrl: `/coach/students/${student._id}/profile-photo`,
        });
      }
    }

    return res.json(eligibleStudents);
  } catch (error) {
    console.error('Coach student directory error:', error);
    return res.status(500).json({ message: 'Server error while fetching students' });
  }
});

router.delete('/coach/athletes/:studentId', protect, authorize('coach'), async (req, res) => {
  try {
    const student = await User.findOne({ _id: req.params.studentId, role: 'student' });
    if (!student) return res.status(404).json({ message: 'Student not found' });
    if (req.user?.sport && student.sport && student.sport !== req.user.sport) {
      return res.status(403).json({ message: 'This student is not assigned to your sport' });
    }
    await User.deleteOne({ _id: student._id });
    return res.json({ success: true, message: 'Student profile deleted successfully' });
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
