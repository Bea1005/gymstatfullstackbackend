const httpMocks = require('node-mocks-http');
const mongoose = require('mongoose');
const { uploadRequirement } = require('../../src/controllers/studentController');
const StudentRequirement = require('../../src/models/StudentRequirement');

const mockSave = jest.fn();

jest.mock('../../src/models/StudentRequirement', () => {
  return jest.fn().mockImplementation((data) => ({
    ...data,
    save: mockSave
  }));
});

describe('Student controller uploads', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSave.mockResolvedValue(true);
  });

  it('stores uploads using the authenticated Mongo ObjectId for the student', async () => {
    const studentObjectId = new mongoose.Types.ObjectId();
    const req = httpMocks.createRequest({
      body: {
        requirementType: 'medical',
        sport: 'Basketball'
      },
      file: {
        path: '/tmp/test.pdf',
        originalname: 'test.pdf',
        mimetype: 'application/pdf',
        size: 120
      }
    });

    req.user = {
      _id: studentObjectId,
      id: '24B1510',
      role: 'student'
    };

    const res = httpMocks.createResponse();

    await uploadRequirement(req, res);

    expect(StudentRequirement).toHaveBeenCalledWith(expect.objectContaining({
      studentId: studentObjectId
    }));
    expect(res.statusCode).toBe(201);
  });
});
