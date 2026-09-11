const httpMocks = require('node-mocks-http');
const express = require('express');
const request = require('supertest');
const StudentRequirement = require('../../src/models/StudentRequirement');
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
});
