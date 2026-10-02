const express = require('express');
const request = require('supertest');
const User = require('../../src/models/User');
const StudentAthlete = require('../../src/models/StudentAthlete');
const StudentProfile = require('../../src/models/StudentProfile');
const StudentRequirement = require('../../src/models/StudentRequirement');
const StrasucFacultyMember = require('../../src/models/StrasucFacultyMember');
const coachRoutes = require('../../src/routes/coachRoutes');
const { streamProfilePhoto } = require('../../src/config/profilePhotoStorage');

jest.mock('../../src/models/User');
jest.mock('../../src/models/StudentAthlete');
jest.mock('../../src/models/StudentProfile');
jest.mock('../../src/models/StudentRequirement');
jest.mock('../../src/models/StrasucFacultyMember');
jest.mock('../../src/middleware/auth', () => ({
  protect: jest.fn((req, res, next) => {
    req.user = { _id: req.headers['x-test-coach-id'] || 'coach-id', role: 'coach' };
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
    StudentAthlete.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  it('returns only the Coach selected students and filters by sport after profile reconciliation', async () => {
    const athlete = {
      _id: 'student-id',
      id: 'STUDENT01',
      fullname: 'Student Name',
      sport: 'Basketball Women',
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
    expect(User.find.mock.calls[0][0]).toEqual({
      role: 'student',
      _id: { $in: [athlete._id] },
    });
    expect(response.body[0]).toEqual(expect.objectContaining({
      id: 'STUDENT01',
      fullname: 'Student Name',
      sport: 'Basketball Women',
      department: 'Engineering',
      yearLevel: 'II',
      branchCampus: 'Boac Main',
    }));
    expect(response.body[0]).not.toHaveProperty('email');
    expect(response.body[0].athleteStatus).toBe('completed');
  });

  it('returns missing Screener requirements by student ID and ignores COR', async () => {
    User.findOne.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({ _id: 'coach-id' }),
    });
    StudentRequirement.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        { requirementType: 'medical', status: 'approved' },
        { requirementType: 'psa', status: 'pending' },
        { requirementType: 'insurance', status: 'approved' },
        { requirementType: 'profile', status: 'approved' },
        { requirementType: 'consent', status: 'approved' },
        { requirementType: 'cor', status: 'rejected' },
        { requirementType: 'other', customRequirementLabel: 'Athlete Waiver', status: 'rejected' },
      ]),
    });

    const response = await request(app)
      .get('/api/v1/coach/athletes/student-id/requirements');

    expect(response.status).toBe(200);
    expect(response.body.missingDocuments).toEqual(['PSA', 'ATHLETE WAIVER']);
    expect(User.findOne.mock.calls[0][0]).toEqual({
      _id: 'coach-id',
      role: 'coach',
      strasucStudentIds: 'student-id',
    });
    expect(StudentRequirement.find.mock.calls[0][0]).toEqual({
      studentId: 'student-id',
      $or: [
        { participationType: 'Intrams' },
        { participationType: { $exists: false } },
      ],
    });
  });

  it('returns no missing requirements when all Screener-required documents are approved despite rejected COR', async () => {
    User.findOne.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({ _id: 'coach-id' }),
    });
    StudentRequirement.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        { requirementType: 'medical', status: 'approved' },
        { requirementType: 'psa', status: 'approved' },
        { requirementType: 'insurance', status: 'approved' },
        { requirementType: 'profile', status: 'approved' },
        { requirementType: 'consent', status: 'approved' },
        { requirementType: 'cor', status: 'rejected' },
      ]),
    });

    const response = await request(app)
      .get('/api/v1/coach/athletes/student-id/requirements');

    expect(response.status).toBe(200);
    expect(response.body.missingDocuments).toEqual([]);
    expect(StudentRequirement.find.mock.calls[0][0]).toEqual({
      studentId: 'student-id',
      $or: [
        { participationType: 'Intrams' },
        { participationType: { $exists: false } },
      ],
    });
  });

  it('denies requirement reads for students outside the Coach gallery', async () => {
    User.findOne.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(null),
    });

    const response = await request(app)
      .get('/api/v1/coach/athletes/other-student/requirements');

    expect(response.status).toBe(403);
    expect(StudentRequirement.find).not.toHaveBeenCalled();
  });

  it('keeps a selected gallery student whose sport exists only in StudentAthlete', async () => {
    const student = {
      _id: 'student-user-id',
      id: '23B1510',
      fullname: 'Bea Dolor Soleta',
      sport: '',
      role: 'student',
    };
    const studentAthlete = {
      userId: student._id,
      id: student.id,
      fullname: student.fullname,
      sport: 'Volleyball Women',
    };
    User.findOne.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({ strasucStudentIds: [student._id] }),
    });
    User.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([student]),
    });
    StudentAthlete.find.mockReturnValueOnce({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([studentAthlete]),
    });
    StudentProfile.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    });

    const response = await request(app)
      .get('/api/v1/coach/athletes?sport=Volleyball%20Women');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([expect.objectContaining({
      id: student.id,
      fullname: student.fullname,
      sport: 'Volleyball Women',
    })]);
    expect(User.find.mock.calls[0][0]._id).toEqual({ $in: [student._id] });
  });

  it('searches shared students by registered ID and selected sport for coaches without sport assignments', async () => {
    const student = {
      _id: 'student-user-id',
      id: '23B1510',
      fullname: 'Bea Dolor Soleta',
      sport: 'Volleyball Women',
      assignedSports: ['Basketball Women'],
      department: 'BSIT',
      yearLevel: 'III',
      dateOfBirth: '2005-09-10',
      branchCampus: 'Boac Main',
      email: 'private@example.com',
    };
    User.findOne.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({ _id: 'coach-id', sport: '', assignedSports: [] }),
    });
    User.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([student]),
    });
    StudentProfile.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{
        studentId: student._id,
        imageFileId: '507f1f77bcf86cd799439011',
      }]),
    });

    const response = await request(app)
      .get('/api/v1/coach/student-search?q=23B1510&sport=Basketball%20Women');

    expect(response.status).toBe(200);
    expect(User.find.mock.calls[0][0]).toEqual(expect.objectContaining({
      role: 'student',
      $and: expect.arrayContaining([
        { $or: expect.arrayContaining([
          { assignedSports: { $regex: '^Basketball Women$', $options: 'i' } },
        ]) },
        { $or: expect.arrayContaining([
          { id: { $regex: '23B1510', $options: 'i' } },
        ]) },
      ]),
    }));
    expect(User.find.mock.calls[0][0]).not.toHaveProperty('_id');
    expect(response.body[0]).toEqual(expect.objectContaining({
      id: '23B1510',
      fullname: 'Bea Dolor Soleta',
      sport: 'Basketball Women',
    }));
    expect(Object.keys(response.body[0]).sort()).toEqual(['_id', 'fullname', 'id', 'sport']);
    expect(response.body[0]).not.toHaveProperty('email');
    expect(response.body[0]).not.toHaveProperty('password');
    expect(response.body[0]).not.toHaveProperty('athleteStatus');
    expect(StudentProfile.find).not.toHaveBeenCalled();
  });

  it('finds a student under every saved sport, not only the legacy primary sport', async () => {
    const student = {
      _id: 'student-user-id',
      id: '23B1510',
      fullname: 'Bea Dolor Soleta',
      sport: 'Basketball Women',
      sports: ['Basketball Women', 'Volleyball Women'],
    };
    const makeFindResult = (documents) => ({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(documents),
    });
    User.findOne.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({ _id: 'coach-id', role: 'coach' }),
    });
    User.find
      .mockReturnValueOnce(makeFindResult([student]))
      .mockReturnValueOnce(makeFindResult([student]));

    const response = await request(app)
      .get('/api/v1/coach/student-search?q=23B1510&sport=Volleyball%20Women');

    expect(response.status).toBe(200);
    expect(User.find.mock.calls[0][0].$and[0].$or).toContainEqual({
      sports: { $regex: '^Volleyball Women$', $options: 'i' },
    });
    expect(response.body).toEqual([{
      _id: student._id,
      id: student.id,
      fullname: student.fullname,
      sport: 'Volleyball Women',
    }]);
  });

  it('preloads all minimal search records for a sport without requiring a query', async () => {
    const student = {
      _id: 'student-user-id',
      id: '23B1510',
      fullname: 'Bea Dolor Soleta',
      sport: 'Basketball Women',
    };
    User.findOne.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({ _id: 'coach-id' }),
    });
    User.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([student]),
    });

    const response = await request(app)
      .get('/api/v1/coach/student-search?sport=Basketball%20Women');

    expect(response.status).toBe(200);
    expect(User.find.mock.calls[0][0]).not.toHaveProperty('$or');
    expect(response.body).toEqual([{
      _id: 'student-user-id',
      id: '23B1510',
      fullname: 'Bea Dolor Soleta',
      sport: 'Basketball Women',
    }]);
    expect(StudentProfile.find).not.toHaveBeenCalled();
  });

  it('matches a secondary sport from the linked StudentAthlete sports array when User sports are empty', async () => {
    const user = {
      _id: 'student-user-id',
      id: '23B1510',
      fullname: 'Bea Dolor Soleta',
      sport: '',
      accountStatus: 'active',
      role: 'student',
    };
    const studentAthlete = {
      userId: user._id,
      id: user.id,
      fullname: user.fullname,
      sport: 'Basketball Women',
      sports: ['Basketball Women', 'Volleyball Women'],
    };
    const makeFindResult = (documents) => ({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(documents),
    });
    User.findOne.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({ _id: 'coach-id' }),
    });
    User.find
      .mockReturnValueOnce(makeFindResult([]))
      .mockReturnValueOnce(makeFindResult([user]));
    StudentAthlete.find
      .mockReturnValueOnce(makeFindResult([studentAthlete]))
      .mockReturnValueOnce(makeFindResult([studentAthlete]));

    const response = await request(app)
      .get('/api/v1/coach/student-search?q=Bea&sport=Volleyball%20Women');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{
      _id: user._id,
      id: user.id,
      fullname: user.fullname,
      sport: 'Volleyball Women',
    }]);
    expect(User.find.mock.calls[1][0].$or).toContainEqual({ _id: { $in: [user._id] } });
  });

  it('does not return an orphaned StudentAthlete record without an active User match', async () => {
    const orphan = {
      userId: 'missing-user-id',
      id: 'ORPHAN01',
      sport: 'Volleyball Women',
    };
    const makeFindResult = (documents) => ({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(documents),
    });
    User.findOne.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({ _id: 'coach-id' }),
    });
    User.find
      .mockReturnValueOnce(makeFindResult([]))
      .mockReturnValueOnce(makeFindResult([]));
    StudentAthlete.find.mockReturnValueOnce(makeFindResult([orphan]));

    const response = await request(app)
      .get('/api/v1/coach/student-search?q=ORPHAN01&sport=Volleyball%20Women');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(User.create).not.toHaveBeenCalled();
  });

  it.each(['coach-a-id', 'coach-b-id'])(
    'adds a matching student to only the authenticated gallery for %s',
    async (coachId) => {
      const student = {
        _id: 'student-user-id',
        id: '23B1510',
        fullname: 'Bea Dolor Soleta',
        sport: 'Basketball Women',
        department: 'BSIT',
        yearLevel: 'III',
      };
      User.findOne
        .mockReturnValueOnce({
          select: jest.fn().mockReturnThis(),
          lean: jest.fn().mockResolvedValue({ _id: coachId, sport: '', assignedSports: [] }),
        })
        .mockReturnValueOnce({
          select: jest.fn().mockReturnThis(),
          lean: jest.fn().mockResolvedValue(student),
        });
      User.updateOne.mockResolvedValue({ matchedCount: 1 });
      StudentProfile.findOne.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(null),
      });

      const response = await request(app)
        .post('/api/v1/coach/athletes')
        .set('x-test-coach-id', coachId)
        .send({ studentId: student._id, sport: 'Basketball Women' });

      expect(response.status).toBe(200);
      expect(User.updateOne).toHaveBeenCalledWith(
        { _id: coachId },
        { $addToSet: { strasucStudentIds: student._id } }
      );
      expect(response.body.data).toEqual(expect.objectContaining({
        id: '23B1510',
        fullname: 'Bea Dolor Soleta',
        sport: 'Basketball Women',
      }));
    }
  );

  it('adds a student whose selected sport exists only in the linked StudentAthlete record', async () => {
    const student = {
      _id: 'student-user-id',
      id: '23B1510',
      fullname: 'Bea Dolor Soleta',
      sport: '',
      role: 'student',
    };
    User.findOne
      .mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue({ _id: 'coach-id' }),
      })
      .mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(student),
      });
    StudentAthlete.findOne.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({
        userId: student._id,
        id: student.id,
        sport: 'Volleyball Women',
      }),
    });
    User.updateOne.mockResolvedValue({ matchedCount: 1 });
    StudentProfile.findOne.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(null),
    });

    const response = await request(app)
      .post('/api/v1/coach/athletes')
      .send({ studentId: student._id, sport: 'Volleyball Women' });

    expect(response.status).toBe(200);
    expect(User.updateOne).toHaveBeenCalledWith(
      { _id: 'coach-id' },
      { $addToSet: { strasucStudentIds: student._id } }
    );
    expect(response.body.data).toEqual(expect.objectContaining({
      id: student.id,
      sport: 'Volleyball Women',
    }));
  });

  it('saves an assigned student profile update for a coach', async () => {
    const student = {
      _id: 'student-id',
      branchCampus: 'Boac Main',
    };
    User.findOne
      .mockResolvedValueOnce(student)
      .mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue({ _id: 'coach-id' }),
      });
    User.findOneAndUpdate.mockResolvedValue({
      ...student,
      fullname: 'Updated Student',
      branchCampus: 'Gasan',
      athleteStatus: 'complete',
    });

    const response = await request(app)
      .put('/api/v1/coach/athletes/student-id')
      .send({ fullname: 'Updated Student', branchCampus: 'Gasan', athleteStatus: 'complete' });

    expect(response.status).toBe(200);
    expect(response.body.athleteStatus).toBe('complete');
    expect(User.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'student-id', role: 'student' },
      { $set: { fullname: 'Updated Student', branchCampus: 'Gasan', athleteStatus: 'complete' } },
      { new: true, runValidators: true }
    );
  });

  it.each(['complete', 'incomplete', 'disqualified', 'no-documents'])(
    'lets an assigned coach set the %s status badge',
    async (athleteStatus) => {
      const student = { _id: '6abfd0a30650e44ccd090471', branchCampus: 'Boac Main' };
      User.findOne
        .mockResolvedValueOnce(student)
        .mockReturnValueOnce({
          select: jest.fn().mockReturnThis(),
          lean: jest.fn().mockResolvedValue({ _id: 'coach-id' }),
        });
      User.findOneAndUpdate.mockResolvedValue({ ...student, athleteStatus });

      const response = await request(app)
        .put(`/api/v1/coach/athletes/${student._id}`)
        .send({ athleteStatus });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        message: 'Student profile updated successfully',
        athleteStatus,
      });
      expect(User.findOne).toHaveBeenCalledWith({
        _id: student._id,
        role: 'student',
      });
      expect(User.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: student._id, role: 'student' },
        { $set: { athleteStatus } },
        { new: true, runValidators: true }
      );
    }
  );

  it('rejects unsupported Coach Portal athlete status badge values', async () => {
    User.findOne
      .mockResolvedValueOnce({ _id: 'student-id', branchCampus: 'Boac Main' })
      .mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue({ _id: 'coach-id' }),
      });

    const response = await request(app)
      .put('/api/v1/coach/athletes/student-id')
      .send({ athleteStatus: 'not-a-status' });

    expect(response.status).toBe(400);
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
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

  it('saves a faculty member without a submitted Faculty Member ID', async () => {
    StrasucFacultyMember.exists.mockResolvedValue(false);
    StrasucFacultyMember.create.mockImplementation(async (faculty) => ({
      ...faculty,
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
      updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    }));

    const response = await request(app)
      .post('/api/v1/coach/faculty-members')
      .send({
        role: 'COACH',
        name: 'Bea Coach',
        age: '30',
        contactNumber: '09170000000',
        email: 'coach@example.com',
      });

    expect(response.status).toBe(201);
    expect(response.body.facultyId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(StrasucFacultyMember.create).toHaveBeenCalledWith(expect.objectContaining({
      coachId: 'coach-id',
      role: 'COACH',
      name: 'Bea Coach',
      age: '30',
      contactNumber: '09170000000',
      email: 'coach@example.com',
    }));
    expect(StrasucFacultyMember.create.mock.calls[0][0].facultyId).toBe(response.body.facultyId);
  });

  it('loads persisted faculty details again for the authenticated Coach', async () => {
    StrasucFacultyMember.find.mockReturnValue({
      sort: jest.fn().mockResolvedValue([{
        facultyId: 'persisted-faculty-id',
        coachId: 'coach-id',
        role: 'COACH',
        name: 'Bea Coach',
        age: '30',
        contactNumber: '09170000000',
        email: 'coach@example.com',
      }]),
    });

    const response = await request(app).get('/api/v1/coach/faculty-members');

    expect(response.status).toBe(200);
    expect(StrasucFacultyMember.find).toHaveBeenCalledWith({ coachId: 'coach-id' });
    expect(response.body).toEqual([expect.objectContaining({
      facultyId: 'persisted-faculty-id',
      fullname: 'Bea Coach',
      role: 'COACH',
      phone: '09170000000',
      email: 'coach@example.com',
    })]);
  });
});