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

  it('deletes the submission when a screener rejects it', async () => {
    const submission = {
      _id: 'submission-1',
      status: 'pending',
      remarks: '',
      save: jest.fn().mockResolvedValue(true)
    };

    StudentRequirement.findById.mockResolvedValue(submission);
    StudentRequirement.findByIdAndDelete.mockResolvedValue({ _id: 'submission-1' });

    const response = await request(app)
      .put('/api/v1/screener/requirements/submission-1/review')
      .send({ status: 'rejected', feedback: 'Wrong file', remarks: 'Please re-upload' });

    expect(response.status).toBe(200);
    expect(StudentRequirement.findByIdAndDelete).toHaveBeenCalledWith('submission-1');
    expect(submission.save).not.toHaveBeenCalled();
    expect(response.body.message).toContain('deleted');
  });
});
