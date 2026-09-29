const httpMocks = require('node-mocks-http');
const express = require('express');
const request = require('supertest');
const StudentRequirement = require('../../src/models/StudentRequirement');
const User = require('../../src/models/User');
const { protect, authorize } = require('../../src/middleware/auth');
const screenerRoutes = require('../../src/routes/screenerRoutes');

jest.mock('../../src/models/StudentRequirement');
jest.mock('../../src/models/User');
jest.mock('../../src/middleware/auth', () => ({
  protect: jest.fn((req, res, next) => next()),
  authorize: jest.fn(() => (req, res, next) => next())
}));

describe('Screener routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
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

  it('excludes the Screener department from listed requirements', async () => {
    User.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        { _id: 'student-own', fullname: 'Own Department Student', department: 'CICS' },
        { _id: 'student-other', fullname: 'Other Department Student', department: 'Engineering' }
      ])
    });
    StudentRequirement.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        {
          _id: 'own-submission',
          studentId: { _id: 'student-own', fullname: 'Own Department Student', department: 'CICS' },
          requirementType: 'cor',
          fileName: 'own.pdf',
          fileData: Buffer.from('own')
        },
        {
          _id: 'other-submission',
          studentId: { _id: 'student-other', fullname: 'Other Department Student', department: 'Engineering' },
          requirementType: 'cor',
          fileName: 'other.pdf',
          fileData: Buffer.from('other')
        }
      ])
    });

    const response = await request(app)
      .get('/api/v1/screener/requirements?participationType=Intrams')
      .set('x-test-role', 'screener')
      .set('x-test-department', 'CICS');

    expect(response.status).toBe(200);
    expect(response.body.data.map((student) => student.department)).toEqual(['Engineering']);
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

  it.each([
    {
      title: 'keeps an older rejected document incomplete even when the newest same-type document is approved',
      documents: [
        { _id: 'older-rejected', studentId: 'student-1', requirementType: 'cor', status: 'rejected', fileName: 'old.pdf', fileType: 'application/pdf', fileData: Buffer.from('old'), uploadDate: new Date('2026-01-01') },
        { _id: 'newer-approved', studentId: 'student-1', requirementType: 'cor', status: 'approved', fileName: 'new.pdf', fileType: 'application/pdf', fileData: Buffer.from('new'), uploadDate: new Date('2026-01-02') },
        { _id: 'other-approved', studentId: 'student-1', requirementType: 'psa', status: 'approved', fileName: 'psa.pdf', fileType: 'application/pdf', fileData: Buffer.from('psa'), uploadDate: new Date('2026-01-03') },
      ],
      expectedOverallStatus: 'Incomplete',
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
      title: 'marks the student approved only when every submitted requirement is approved',
      documents: [
        { _id: 'approved-cor', studentId: 'student-1', requirementType: 'cor', status: 'approved', fileName: 'cor.pdf', fileType: 'application/pdf', fileData: Buffer.from('cor'), uploadDate: new Date('2026-01-01') },
        { _id: 'approved-psa', studentId: 'student-1', requirementType: 'psa', status: 'approved', fileName: 'psa.pdf', fileType: 'application/pdf', fileData: Buffer.from('psa'), uploadDate: new Date('2026-01-02') },
      ],
      expectedOverallStatus: 'Approved',
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
