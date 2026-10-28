const httpMocks = require('node-mocks-http');
const express = require('express');
const request = require('supertest');
const StudentRequirement = require('../../src/models/StudentRequirement');
const StudentRequirementStrasuc = require('../../src/models/StudentRequirementStrasuc');
const User = require('../../src/models/User');
const StudentAthlete = require('../../src/models/StudentAthlete');
const { protect, authorize } = require('../../src/middleware/auth');
const screenerRoutes = require('../../src/routes/screenerRoutes');

jest.mock('../../src/models/StudentRequirement');
jest.mock('../../src/models/StudentRequirementStrasuc', () => ({
  find: jest.fn()
}));
jest.mock('../../src/models/User');
jest.mock('../../src/models/StudentAthlete');
jest.mock('../../src/middleware/auth', () => ({
  protect: jest.fn((req, res, next) => next()),
  authorize: jest.fn(() => (req, res, next) => next())
}));

describe('Screener routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    StudentAthlete.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([])
    });
    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.user = {
        _id: 'screener-1',
        role: req.get('x-test-role') || 'admin',
        department: req.get('x-test-department') || 'CICS'
      };
      next();
    });
    app.use('/api/v1', screenerRoutes);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.log.mockRestore();
    console.error.mockRestore();
  });

  it('lists only submitted students matching the coach sports and event assignments', async () => {
    const makeQuery = (result) => ({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(result)
    });
    User.findById.mockReturnValue(makeQuery({
      role: 'coach',
      assignedSports: ['Basketball Women', 'Softball'],
      assignedEvents: ['Intrams']
    }));
    User.find.mockReturnValue(makeQuery([
      {
        _id: 'student-matched',
        id: 'STU-001',
        fullname: 'Matched Student',
        sport: 'Basketball Women',
        sports: ['Basketball Women', 'Softball'],
        department: 'Engineering'
      },
      {
        _id: 'student-unrelated',
        id: 'STU-002',
        fullname: 'Unrelated Student',
        sports: ['Track and Field'],
        department: 'Engineering'
      }
    ]));
    StudentAthlete.find.mockReturnValue(makeQuery([]));
    StudentRequirement.find.mockReturnValue(makeQuery([
      {
        _id: 'submission-matched',
        studentId: 'student-matched',
        requirementType: 'cor',
        participationType: 'Intrams',
        sport: 'Basketball Women',
        fileName: 'registration.pdf',
        fileType: 'application/pdf',
        fileSize: 64,
        files: [
          { fileName: 'front.jpg', fileType: 'image/jpeg', fileSize: 30 },
          { fileName: 'back.jpg', fileType: 'image/jpeg', fileSize: 34 }
        ],
        status: 'pending'
      },
      {
        _id: 'submission-other-event',
        studentId: 'student-matched',
        requirementType: 'psa',
        participationType: 'STRASUC',
        sport: 'Softball',
        fileName: 'psa.pdf',
        fileType: 'application/pdf',
        fileSize: 64,
        status: 'pending'
      }
    ]));

    const response = await request(app)
      .get('/api/v1/coach/requirements')
      .set('x-test-role', 'coach');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toEqual(expect.objectContaining({
      id: 'student-matched',
      name: 'Matched Student',
      sports: ['Basketball Women', 'Softball']
    }));
    expect(response.body.data[0].requirements.documents).toHaveLength(1);
    expect(response.body.data[0].requirements.documents[0].files).toHaveLength(2);
    expect(response.body.data[0].requirements.documents[0].fileUrl).toContain('/coach/requirements/');
    expect(StudentRequirement.find).toHaveBeenCalledTimes(1);
  });

  it('groups a student assigned to multiple sports and events without duplicate entries', async () => {
    const makeQuery = (result) => ({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(result)
    });
    User.findById.mockReturnValue(makeQuery({
      role: 'coach',
      assignedSports: ['Basketball Women', 'Softball'],
      assignedEvents: ['Intrams', 'STRASUC']
    }));
    User.find.mockReturnValue(makeQuery([{
      _id: 'student-multiple',
      id: 'STU-003',
      fullname: 'Multi-sport Student',
      sports: ['Basketball Women', 'Softball'],
      department: 'Engineering'
    }]));
    StudentAthlete.find.mockReturnValue(makeQuery([]));
    StudentRequirement.find.mockReturnValue(makeQuery([{
      _id: 'intrams-submission',
      studentId: 'student-multiple',
      requirementType: 'cor',
      participationType: 'Intrams',
      sport: 'Basketball Women',
      fileName: 'intrams.pdf',
      fileType: 'application/pdf',
      fileSize: 10,
      status: 'pending'
    }]));
    StudentRequirementStrasuc.find.mockReturnValue(makeQuery([{
      _id: 'strasuc-submission',
      studentId: 'student-multiple',
      requirementType: 'psa',
      participationType: 'STRASUC',
      sport: 'Softball',
      fileName: 'strasuc.pdf',
      fileType: 'application/pdf',
      fileSize: 12,
      status: 'pending'
    }]));

    const response = await request(app)
      .get('/api/v1/coach/requirements')
      .set('x-test-role', 'coach');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].requirements.documents.map((entry) => entry.participationType))
      .toEqual(expect.arrayContaining(['Intrams', 'STRASUC']));
    expect(StudentRequirementStrasuc.find).toHaveBeenCalledTimes(1);
  });

  it('denies a coach review when the student sports do not match the coach assignment', async () => {
    const makeQuery = (result) => ({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(result)
    });
    const submission = {
      _id: 'submission-track',
      studentId: 'student-track',
      participationType: 'Intrams',
      sport: 'Track and Field',
      status: 'pending',
      save: jest.fn().mockResolvedValue(true)
    };
    User.findById.mockReturnValue(makeQuery({
      role: 'coach',
      assignedSports: ['Basketball Women']
    }));
    User.findOne.mockReturnValue(makeQuery({
      _id: 'student-track',
      role: 'student',
      sports: ['Track and Field']
    }));
    StudentAthlete.find.mockReturnValue(makeQuery([]));
    StudentRequirement.findById.mockResolvedValue(submission);

    const response = await request(app)
      .put('/api/v1/coach/requirements/submission-track/review')
      .set('x-test-role', 'coach')
      .send({
        status: 'approved',
        studentId: 'student-track',
        participationType: 'Intrams'
      });

    expect(response.status).toBe(403);
    expect(submission.save).not.toHaveBeenCalled();
  });

  it('denies document previews for students outside the coach sports', async () => {
    const makeQuery = (result) => ({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(result)
    });
    const submissionId = '507f1f77bcf86cd799439011';
    User.findById.mockReturnValue(makeQuery({
      role: 'coach',
      assignedSports: ['Basketball Women']
    }));
    User.findOne.mockReturnValue(makeQuery({
      _id: 'student-track',
      role: 'student',
      sports: ['Track and Field']
    }));
    StudentAthlete.find.mockReturnValue(makeQuery([]));
    StudentRequirement.findById.mockReturnValue(makeQuery({
      _id: submissionId,
      studentId: 'student-track',
      participationType: 'Intrams',
      sport: 'Track and Field',
      fileName: 'track.pdf',
      fileType: 'application/pdf',
      fileData: Buffer.from('private')
    }));

    const response = await request(app)
      .get(`/api/v1/coach/requirements/${submissionId}/preview?participationType=Intrams`)
      .set('x-test-role', 'coach');

    expect(response.status).toBe(403);
    expect(response.body.message).toContain('not authorized');
  });

  it('approves an assigned student submission in the existing record', async () => {
    const makeQuery = (result) => ({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(result)
    });
    const submission = {
      _id: 'submission-basketball',
      studentId: 'student-basketball',
      participationType: 'Intrams',
      sport: 'Basketball Women',
      status: 'pending',
      save: jest.fn().mockResolvedValue(true)
    };
    User.findById.mockReturnValue(makeQuery({
      role: 'coach',
      assignedSports: ['Basketball Women']
    }));
    User.findOne.mockReturnValue(makeQuery({
      _id: 'student-basketball',
      role: 'student',
      sports: ['Basketball Women']
    }));
    StudentAthlete.find.mockReturnValue(makeQuery([]));
    StudentRequirement.findById.mockResolvedValue(submission);

    const response = await request(app)
      .put('/api/v1/coach/requirements/submission-basketball/review')
      .set('x-test-role', 'coach')
      .send({
        status: 'approved',
        studentId: 'student-basketball',
        participationType: 'Intrams'
      });

    expect(response.status).toBe(200);
    expect(submission.status).toBe('approved');
    expect(submission.approvedBy).toBe('screener-1');
    expect(submission.reviewedBy).toBe('screener-1');
    expect(submission.save).toHaveBeenCalled();
  });

  it('retains the submission and saves the rejection reason', async () => {
    const submission = {
      _id: 'submission-1',
      studentId: 'student-1',
      filePath: 'uploads/requirements/rejected.pdf',
      status: 'pending',
      remarks: '',
      save: jest.fn().mockResolvedValue(true)
    };

    StudentRequirement.findById.mockResolvedValue(submission);

    const response = await request(app)
      .put('/api/v1/screener/requirements/submission-1/review')
      .send({ status: 'rejected', studentId: 'student-1', feedback: 'Wrong file', remarks: 'Please re-upload' });

    expect(response.status).toBe(200);
    expect(StudentRequirement.findByIdAndDelete).not.toHaveBeenCalled();
    expect(submission.status).toBe('rejected');
    expect(submission.remarks).toBe('Wrong file — Please re-upload');
    expect(submission.save).toHaveBeenCalled();
    expect(response.body.message).toContain('retained');
  });

  it('rejects deletion when the requirement belongs to another student', async () => {
    StudentRequirement.findById.mockResolvedValue({
      _id: 'submission-3',
      studentId: 'student-1',
      filePath: 'uploads/requirements/other.pdf'
    });

    const response = await request(app)
      .put('/api/v1/screener/requirements/submission-3/review')
      .send({ status: 'rejected', studentId: 'student-2' });

    expect(response.status).toBe(403);
    expect(StudentRequirement.findByIdAndDelete).not.toHaveBeenCalled();
  });

  it('marks an existing submission as viewed', async () => {
    const submission = {
      _id: 'submission-2',
      resubmitted: true,
      save: jest.fn().mockResolvedValue(true)
    };

    StudentRequirement.findById.mockResolvedValue(submission);

    const response = await request(app)
      .put('/api/v1/screener/requirements/submission-2/viewed');

    expect(response.status).toBe(200);
    expect(submission.resubmitted).toBe(false);
    expect(submission.save).toHaveBeenCalled();
  });

  it('blocks Screener access to the retired requirement screening list', async () => {
    User.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        { _id: 'student-own', fullname: 'Own Department Student', department: 'CICS', yearLevel: 'I' },
        { _id: 'student-other', fullname: 'Other Department Student', department: 'Engineering', yearLevel: ' II ' },
        { _id: 'student-without-year', fullname: 'Student Without Year Level', department: 'Engineering', yearLevel: '' }
      ])
    });
    StudentAthlete.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        { userId: 'student-other', yearLevel: 'II', sports: ['SOFTBALL'] },
        { userId: 'student-without-year', yearLevel: '', sports: [] }
      ])
    });
    StudentRequirement.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        {
          _id: 'own-submission',
          studentId: { _id: 'student-own', fullname: 'Own Department Student', department: 'CICS', yearLevel: 'I' },
          requirementType: 'cor',
          fileName: 'own.pdf',
          fileSize: 3,
          fileData: Buffer.from('own')
        },
        {
          _id: 'other-submission',
          studentId: { _id: 'student-other', fullname: 'Other Department Student', department: 'Engineering', yearLevel: 'II' },
          requirementType: 'cor',
          fileName: 'other.pdf',
          fileSize: 5,
          fileData: Buffer.from('other')
        }
      ])
    });

    const response = await request(app)
      .get('/api/v1/screener/requirements?participationType=Intrams')
      .set('x-test-role', 'screener')
      .set('x-test-department', 'CICS');

    expect(response.status).toBe(403);
    expect(response.body.message).toContain('moved to the Coach Portal');
    expect(User.find).not.toHaveBeenCalled();
  });

  it('returns all saved profile sports and links submissions once by student ID', async () => {
    User.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        {
          _id: 'student-bea',
          id: 'BEA-001',
          fullname: 'Bea',
          department: 'Engineering',
          yearLevel: 'IV',
          sport: 'USER FIELD SPORT MUST NOT MATCH',
          sports: ['USER FIELD SPORT MUST NOT MATCH']
        }
      ])
    });
    StudentAthlete.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        {
          userId: 'student-bea',
          yearLevel: '2nd Year',
          sport: 'DIFFERENT ATHLETE SPORT FIELD',
          sports: [' WOMEN BASKETBALL ', 'SOFTBALL', '', null, 'softball']
        }
      ])
    });
    StudentRequirement.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        {
          _id: 'bea-cor-submission',
          studentId: 'student-bea',
          requirementType: 'cor',
          fileName: 'bea-cor.pdf',
          fileType: 'application/pdf',
          fileSize: 128,
          files: [
            { fileName: 'front.jpg', fileType: 'image/jpeg', fileSize: 64 },
            { fileName: 'back.jpg', fileType: 'image/jpeg', fileSize: 64 }
          ],
          status: 'approved',
          uploadDate: '2026-10-01T00:00:00.000Z'
        }
      ])
    });

    const response = await request(app)
      .get('/api/v1/screener/requirements?participationType=Intrams')
      .set('x-test-role', 'admin')
      .set('x-test-department', 'CICS');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toEqual(expect.objectContaining({
      id: 'student-bea',
      name: 'Bea',
      sport: 'WOMEN BASKETBALL',
      sports: ['WOMEN BASKETBALL', 'SOFTBALL', 'softball'],
      yearLevel: '2nd Year'
    }));
    expect(response.body.data[0].requirements.documents).toHaveLength(1);
    expect(response.body.data[0].requirements.documents[0]).toEqual(expect.objectContaining({
      submissionId: 'bea-cor-submission',
      fileName: 'bea-cor.pdf',
      status: 'approved',
      hasUpload: true,
      files: [
        expect.objectContaining({ fileName: 'front.jpg', fileType: 'image/jpeg', fileUrl: expect.stringContaining('fileIndex=0') }),
        expect.objectContaining({ fileName: 'back.jpg', fileType: 'image/jpeg', fileUrl: expect.stringContaining('fileIndex=1') })
      ]
    }));
    expect(StudentRequirement.find).toHaveBeenCalledWith({
      $or: [{ participationType: 'Intrams' }, { participationType: { $exists: false } }]
    });
    expect(StudentAthlete.find().select).toHaveBeenCalledWith('userId sports yearLevel');
  });

  it('uses only the linked Student Athlete sports array and year level', async () => {
    User.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        {
          _id: 'student-legacy',
          id: 'LEGACY-001',
          fullname: 'Legacy Student',
          department: 'Engineering',
          yearLevel: 'I',
          sport: 'USER FIELD SPORT',
          sports: ['USER FIELD SPORT']
        }
      ])
    });
    StudentAthlete.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        {
          userId: 'student-legacy',
          yearLevel: 'III',
          sport: 'ATHLETE SINGLE SPORT FIELD',
          sports: ['WOMEN BASKETBALL', 'SOFTBALL']
        }
      ])
    });
    StudentRequirement.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([])
    });

    const response = await request(app)
      .get('/api/v1/screener/requirements?participationType=Intrams')
      .set('x-test-role', 'admin')
      .set('x-test-department', 'CICS');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([
      expect.objectContaining({
        id: 'student-legacy',
        sport: 'WOMEN BASKETBALL',
        sports: ['WOMEN BASKETBALL', 'SOFTBALL'],
        yearLevel: 'III'
      })
    ]);
    expect(StudentAthlete.find).toHaveBeenCalledWith({
      userId: { $in: ['student-legacy'] }
    });
  });

  it('does not fall back to the separate sport field when the sports array is empty', async () => {
    User.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        {
          _id: 'student-empty-sports',
          fullname: 'Student With Empty Sports',
          department: 'Engineering',
          sport: 'USER SPORT MUST NOT MATCH',
          sports: ['USER SPORT MUST NOT MATCH']
        }
      ])
    });
    StudentAthlete.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        {
          userId: 'student-empty-sports',
          sport: 'ATHLETE SPORT MUST NOT MATCH',
          sports: [],
          yearLevel: 'I'
        }
      ])
    });
    StudentRequirement.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([])
    });

    const response = await request(app)
      .get('/api/v1/screener/requirements?participationType=Intrams')
      .set('x-test-role', 'admin')
      .set('x-test-department', 'CICS');

    expect(response.status).toBe(200);
    expect(response.body.data[0]).toEqual(expect.objectContaining({
      id: 'student-empty-sports',
      sports: [],
      sport: 'Not specified',
      yearLevel: 'I'
    }));
  });

  it('denies Screener review of a same-department requirement', async () => {
    const submission = {
      _id: 'own-submission',
      studentId: 'student-own',
      save: jest.fn()
    };
    StudentRequirement.findById.mockResolvedValue(submission);
    User.findById.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({ department: 'CICS' })
    });

    const response = await request(app)
      .put('/api/v1/screener/requirements/own-submission/review')
      .set('x-test-role', 'screener')
      .set('x-test-department', 'CICS')
      .send({ status: 'approved' });

    expect(response.status).toBe(403);
    expect(submission.save).not.toHaveBeenCalled();
  });

  it('previews the stored submission bytes by MongoDB ID with the saved MIME type', async () => {
    const submissionId = '507f1f77bcf86cd799439011';
    const uploadedImage = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    StudentRequirement.findById.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({
        _id: submissionId,
        fileName: 'student-profile.png',
        fileType: 'image/png',
        fileData: uploadedImage,
        participationType: 'Intrams',
      }),
    });

    const response = await request(app)
      .get(`/api/v1/screener/requirements/${submissionId}/preview?participationType=Intrams`);

    expect(response.status).toBe(200);
    expect(StudentRequirement.findById).toHaveBeenCalledWith(submissionId);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['content-disposition']).toContain('inline');
    expect(Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body)).toEqual(uploadedImage);
  });

  it('previews the selected photo from a multi-photo requirement submission', async () => {
    const submissionId = '507f1f77bcf86cd799439011';
    const secondPhoto = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    StudentRequirement.findById.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({
        _id: submissionId,
        files: [
          { fileName: 'front.jpg', fileType: 'image/jpeg', fileData: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) },
          { fileName: 'back.jpg', fileType: 'image/jpeg', fileData: secondPhoto }
        ],
        participationType: 'Intrams',
      }),
    });

    const response = await request(app)
      .get(`/api/v1/screener/requirements/${submissionId}/preview?participationType=Intrams&fileIndex=1`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body)).toEqual(secondPhoto);
  });

  it('denies Screener preview of a same-department requirement', async () => {
    const submissionId = '507f1f77bcf86cd799439011';
    StudentRequirement.findById.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({
        _id: submissionId,
        studentId: 'student-own',
        fileName: 'own.pdf',
        fileType: 'application/pdf',
        fileData: Buffer.from('private requirement')
      })
    });
    User.findById.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({ department: 'CICS' })
    });

    const response = await request(app)
      .get(`/api/v1/screener/requirements/${submissionId}/preview?participationType=Intrams`)
      .set('x-test-role', 'screener')
      .set('x-test-department', 'CICS');

    expect(response.status).toBe(403);
    expect(response.body.message).toContain('not authorized');
  });

  const approvedRequiredDocuments = () => [
    { _id: 'approved-med', studentId: 'student-1', requirementType: 'medical', status: 'approved', fileName: 'medical.pdf', fileType: 'application/pdf', fileData: Buffer.from('medical') },
    { _id: 'approved-psa', studentId: 'student-1', requirementType: 'psa', status: 'approved', fileName: 'psa.pdf', fileType: 'application/pdf', fileData: Buffer.from('psa') },
    { _id: 'approved-insurance', studentId: 'student-1', requirementType: 'insurance', status: 'approved', fileName: 'insurance.pdf', fileType: 'application/pdf', fileData: Buffer.from('insurance') },
    { _id: 'approved-profile', studentId: 'student-1', requirementType: 'profile', status: 'approved', fileName: 'profile.pdf', fileType: 'application/pdf', fileData: Buffer.from('profile') },
    { _id: 'approved-consent', studentId: 'student-1', requirementType: 'consent', status: 'approved', fileName: 'consent.pdf', fileType: 'application/pdf', fileData: Buffer.from('consent') },
  ];

  it.each([
    {
      title: 'ignores rejected COR history when all required documents are approved',
      documents: [
        { _id: 'older-rejected', studentId: 'student-1', requirementType: 'cor', status: 'rejected', fileName: 'old.pdf', fileType: 'application/pdf', fileData: Buffer.from('old'), uploadDate: new Date('2026-01-01') },
        { _id: 'newer-approved', studentId: 'student-1', requirementType: 'cor', status: 'approved', fileName: 'new.pdf', fileType: 'application/pdf', fileData: Buffer.from('new'), uploadDate: new Date('2026-01-02') },
        ...approvedRequiredDocuments(),
      ],
      expectedOverallStatus: 'Completed',
    },
    {
      title: 'keeps a student incomplete when a new requirement is pending among approved requirements',
      documents: [
        { _id: 'approved-cor', studentId: 'student-1', requirementType: 'cor', status: 'approved', fileName: 'cor.pdf', fileType: 'application/pdf', fileData: Buffer.from('cor'), uploadDate: new Date('2026-01-01') },
        { _id: 'approved-psa', studentId: 'student-1', requirementType: 'psa', status: 'approved', fileName: 'psa.pdf', fileType: 'application/pdf', fileData: Buffer.from('psa'), uploadDate: new Date('2026-01-02') },
        { _id: 'pending-consent', studentId: 'student-1', requirementType: 'consent', status: 'pending', fileName: 'consent.pdf', fileType: 'application/pdf', fileData: Buffer.from('consent'), uploadDate: new Date('2026-01-03') },
      ],
      expectedOverallStatus: 'Incomplete',
    },
    {
      title: 'marks the student completed when all required documents and COR are approved',
      documents: [
        { _id: 'approved-cor', studentId: 'student-1', requirementType: 'cor', status: 'approved', fileName: 'cor.pdf', fileType: 'application/pdf', fileData: Buffer.from('cor'), uploadDate: new Date('2026-01-01') },
        ...approvedRequiredDocuments(),
      ],
      expectedOverallStatus: 'Completed',
    },
    {
      title: 'marks the student completed when every required document is approved and no COR exists',
      documents: approvedRequiredDocuments(),
      expectedOverallStatus: 'Completed',
    },
    {
      title: 'marks the student incomplete when a required Medical Certificate is missing but COR is also absent',
      documents: approvedRequiredDocuments().filter((document) => document.requirementType !== 'medical'),
      expectedOverallStatus: 'Incomplete',
    },
    {
      title: 'marks the student incomplete when a required Insurance document is rejected even if COR is absent',
      documents: approvedRequiredDocuments().map((document) => document.requirementType === 'insurance'
        ? { ...document, status: 'rejected' }
        : document),
      expectedOverallStatus: 'Incomplete',
    },
  ])('$title', async ({ documents, expectedOverallStatus }) => {
    User.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{
        _id: 'student-1',
        fullname: 'Test Student',
        department: 'CICS',
        sport: 'Basketball',
      }]),
    });
    StudentRequirement.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(documents.map((document) => ({
        ...document,
        studentId: {
          _id: 'student-1',
          fullname: 'Test Student',
          department: 'CICS',
          sport: 'Basketball',
        },
      }))),
    });

    const response = await request(app).get('/api/v1/screener/requirements?participationType=Intrams');

    expect(response.status).toBe(200);
    expect(response.body.data[0].overallStatus).toBe(expectedOverallStatus);
    expect(response.body.data[0].requirements.documents).toHaveLength(documents.length);
  });
});
