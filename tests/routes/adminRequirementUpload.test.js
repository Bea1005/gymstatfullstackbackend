const express = require('express');
const request = require('supertest');
const { createRequirement } = require('../../src/controllers/requirementController');
const requirementRoutes = require('../../src/routes/requirementRoutes');

jest.mock('../../src/middleware/auth', () => ({
  protect: jest.fn((req, res, next) => next()),
  authorize: jest.fn(() => (req, res, next) => next()),
}));

jest.mock('../../src/controllers/requirementController', () => ({
  createRequirement: jest.fn((req, res) => res.status(201).json({
    success: true,
    file: {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      bytes: req.file.buffer.toString(),
    },
  })),
  publishRequirement: jest.fn(),
  getAllRequirements: jest.fn(),
  getPublishedRequirements: jest.fn(),
  getRequirementById: jest.fn(),
  updateRequirement: jest.fn(),
  deleteRequirement: jest.fn(),
  submitRequirement: jest.fn(),
  getMySubmissions: jest.fn(),
  getAllSubmissions: jest.fn(),
  reviewSubmission: jest.fn(),
  downloadRequirement: jest.fn(),
}));

describe('Admin requirement multipart upload route', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use('/api/v1/requirements', requirementRoutes);
  });

  it.each([
    ['consent.pdf', 'application/pdf'],
    ['consent.doc', 'application/msword'],
    ['consent.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ])('accepts the Admin fields and actual file bytes for %s', async (filename, contentType) => {
    const fileBytes = Buffer.from(`uploaded bytes for ${filename}`);
    const response = await request(app)
      .post('/api/v1/requirements')
      .field('title', 'Consent Form')
      .field('description', 'Parent/Guardian consent for Consent Form')
      .field('type', 'consent')
      .field('sport', 'General')
      .field('priority', 'medium')
      .field('dueDate', '2026-10-29T00:00:00.000Z')
      .field('instructions', 'Please submit your Consent Form')
      .field('targetStudents', 'all')
      .field('isActive', 'true')
      .attach('file', fileBytes, { filename, contentType });

    expect(response.status).toBe(201);
    expect(createRequirement).toHaveBeenCalledTimes(1);
    expect(createRequirement.mock.calls[0][0].body.description).toBe('Parent/Guardian consent for Consent Form');
    expect(createRequirement.mock.calls[0][0].file.buffer).toEqual(fileBytes);
    expect(response.body.file).toEqual({
      originalname: filename,
      mimetype: contentType,
      bytes: fileBytes.toString(),
    });
  });

  it('continues to reject unexpected multipart fields', async () => {
    const response = await request(app)
      .post('/api/v1/requirements')
      .field('title', 'Consent Form')
      .field('unexpectedField', 'not accepted')
      .attach('file', Buffer.from('uploaded bytes'), {
        filename: 'consent.pdf',
        contentType: 'application/pdf',
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Request body contains an unexpected field.');
    expect(createRequirement).not.toHaveBeenCalled();
  });
});