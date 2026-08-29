const httpMocks = require('node-mocks-http');
const mongoose = require('mongoose');
const { uploadRequirement, buildRequirementLifecycleState } = require('../../src/controllers/studentController');
const StudentRequirement = require('../../src/models/StudentRequirement');

const mockSave = jest.fn();
const mockQuery = (value) => ({
  sort: jest.fn().mockResolvedValue(value)
});

jest.mock('../../src/models/StudentRequirement', () => {
  const MockStudentRequirement = jest.fn().mockImplementation((data) => ({
    ...data,
    save: mockSave
  }));

  MockStudentRequirement.findOne = jest.fn(() => mockQuery(null));
  MockStudentRequirement.find = jest.fn(() => mockQuery([]));
  MockStudentRequirement.findByIdAndUpdate = jest.fn().mockResolvedValue(null);

  return MockStudentRequirement;
});

describe('Student controller uploads', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSave.mockResolvedValue(true);
    StudentRequirement.findOne.mockImplementation(() => mockQuery(null));
    StudentRequirement.find.mockImplementation(() => mockQuery([]));
    StudentRequirement.findByIdAndUpdate.mockResolvedValue(null);
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

    expect(res.statusCode).toBe(201);
    expect(res._getJSONData()).toMatchObject({
      success: true,
      message: 'Requirement uploaded successfully'
    });
  });

  it('marks prior-year approved requirements as expired unless they are reusable PSA requirements', () => {
    expect(buildRequirementLifecycleState({
      status: 'approved',
      requirementType: 'medical',
      academicYear: '2024-2025',
      requirementStatus: 'active',
      importedFromPreviousYear: false
    }, '2025-2026')).toBe('expired');

    expect(buildRequirementLifecycleState({
      status: 'approved',
      requirementType: 'psa',
      academicYear: '2024-2025',
      requirementStatus: 'reusable',
      importedFromPreviousYear: true
    }, '2025-2026')).toBe('reusable');
  });
});
