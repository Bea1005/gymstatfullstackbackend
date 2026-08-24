const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { protect, authorize } = require('../middleware/auth');

// GET coach profile
router.get('/coach/profile', protect, authorize('coach'), async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');

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

    const user = await User.findById(req.user.id);
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

    return res.json(athletes.map((athlete) => ({
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
      profilePhoto: athlete.profilePhoto || '',
      sport: athlete.sport || '',
      createdAt: athlete.createdAt,
      updatedAt: athlete.updatedAt,
    })));
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
    return res.json(students);
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
