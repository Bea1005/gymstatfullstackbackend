const express = require('express');
const request = require('supertest');
const User = require('../../src/models/User');
const StudentProfile = require('../../src/models/StudentProfile');
const StrasucFacultyMember = require('../../src/models/StrasucFacultyMember');
const coachRoutes = require('../../src/routes/coachRoutes');
const { streamProfilePhoto } = require('../../src/config/profilePhotoStorage');

jest.mock('../../src/models/User');
jest.mock('../../src/models/StudentProfile');
jest.mock('../../src/models/StrasucFacultyMember');
jest.mock('../../src/middleware/auth', () => ({
  protect: jest.fn((req, res, next) => {
    req.user = { _id: 'coach-id', role: 'coach' };
    next();
  }),
  authorize: jest.fn(() => (req, res, next) => next()),
}));
jest.mock('../../src/config/profilePhotoStorage', () => ({
  streamProfilePhoto: jest.fn(),
  uploadProfilePhoto: jest.fn(),
  deleteProfilePhoto: jest.fn(),
}));

describe('Coach athlete routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/v1', coachRoutes);
    User.schema = {
      path: jest.fn(() => ({ enumValues: ['', 'Boac Main', 'Santa Cruz', 'Gasan', 'Torrijos'] })),
    };
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  it('returns assignedSports athletes with persisted profile fields for the selected category', async () => {
    const athlete = {
      _id: 'student-id',
      id: 'STUDENT01',
      fullname: 'Student Name',
      email: 'student@example.com',
      sport: 'Volleyball Women',
      assignedSports: ['Basketball Women'],
      athleteStatus: 'completed',
      department: 'Engineering',
      yearLevel: 'II',
      branchCampus: 'Boac Main',
    };
    User.findOne.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({ strasucStudentIds: [athlete._id] }),
    });
    User.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([athlete]),
    });
    StudentProfile.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    });

    const response = await request(app)
      .get('/api/v1/coach/athletes?sport=Basketball%20Women');

    expect(response.status).toBe(200);
    expect(User.find.mock.calls[0][0].$and[0].$or).toEqual(expect.arrayContaining([
      { assignedSports: { $regex: '^Basketball Women$', $options: 'i' } },
    ]));
    expect(response.body[0]).toEqual(expect.objectContaining({
      email: 'student@example.com',
      sport: 'Volleyball Women',
      assignedSports: ['Basketball Women'],
      athleteStatus: 'completed',
    }));
  });

  it('saves an assigned student profile update for a coach', async () => {
    const student = {
      _id: 'student-id',
      branchCampus: 'Boac Main',
      save: jest.fn().mockResolvedValue(true),
    };
    User.findOne
      .mockResolvedValueOnce(student)
      .mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue({ _id: 'coach-id' }),
      });

    const response = await request(app)
      .put('/api/v1/coach/athletes/student-id')
      .send({ fullname: 'Updated Student', branchCampus: 'Gasan', athleteStatus: 'completed' });

    expect(response.status).toBe(200);
    expect(student).toEqual(expect.objectContaining({
      fullname: 'Updated Student',
      branchCampus: 'Gasan',
      athleteStatus: 'completed',
    }));
    expect(student.save).toHaveBeenCalledTimes(1);
  });

  it('serves the assigned student profile image from the stored profile reference and MIME type', async () => {
    User.findOne
      .mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue({ _id: 'coach-id' }),
      })
      .mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue({ _id: 'student-id' }),
      });
    StudentProfile.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        imageFileId: '507f1f77bcf86cd799439011',
        mimeType: 'image/png',
      }),
    });
    streamProfilePhoto.mockImplementation(async (_fileId, response) => response.end());

    const response = await request(app)
      .get('/api/v1/coach/students/student-id/profile-photo');

    expect(response.status).toBe(200);
    expect(User.findOne).toHaveBeenNthCalledWith(1, {
      _id: 'coach-id',
      role: 'coach',
      strasucStudentIds: 'student-id',
    });
    expect(StudentProfile.findOne).toHaveBeenCalledWith({ studentId: 'student-id' });
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['content-disposition']).toBe('inline');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(streamProfilePhoto).toHaveBeenCalledWith('507f1f77bcf86cd799439011', expect.anything());
  });

  it('serves the coach faculty profile image using its stored image reference and MIME type', async () => {
    StrasucFacultyMember.findOne.mockResolvedValue({
      facultyId: 'coach-faculty-id',
      imageFileId: '507f1f77bcf86cd799439012',
      imageMimeType: 'image/png',
    });
    streamProfilePhoto.mockImplementation(async (_fileId, response) => response.end());

    const response = await request(app)
      .get('/api/v1/coach/faculty-members/coach-faculty-id/profile-photo');

    expect(response.status).toBe(200);
    expect(StrasucFacultyMember.findOne).toHaveBeenCalledWith({
      coachId: 'coach-id',
      facultyId: 'coach-faculty-id',
    });
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['content-disposition']).toBe('inline');
    expect(streamProfilePhoto).toHaveBeenCalledWith('507f1f77bcf86cd799439012', expect.anything());
  });
});