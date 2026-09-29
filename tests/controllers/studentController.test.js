const httpMocks = require('node-mocks-http');
const mongoose = require('mongoose');
const { uploadRequirement, buildRequirementLifecycleState } = require('../../src/controllers/studentController');
const StudentRequirement = require('../../src/models/StudentRequirement');

const mockSave = jest.fn();
const mockQuery = (value) => ({
  sort: jest.fn().mockResolvedValue(value),
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(value)
});

jest.mock('../../src/models/StudentRequirement', () => {
  const MockStudentRequirement = jest.fn().mockImplementation((data) => ({
    ...data,
    save: mockSave
  }));

  MockStudentRequirement.findOne = jest.fn(() => mockQuery(null));
  MockStudentRequirement.find = jest.fn(() => mockQuery([]));
  MockStudentRequirement.deleteMany = jest.fn().mockResolvedValue({ deletedCount: 0 });
  MockStudentRequirement.findByIdAndUpdate = jest.fn().mockResolvedValue(null);

  return MockStudentRequirement;
});

describe('Student controller uploads', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSave.mockResolvedValue(true);
    StudentRequirement.findOne.mockImplementation(() => mockQuery(null));
    StudentRequirement.find.mockImplementation(() => mockQuery([]));
    StudentRequirement.deleteMany.mockResolvedValue({ deletedCount: 0 });
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

  it('updates the original PSA document and removes only duplicate PSA records after replacement', async () => {
    const studentId = new mongoose.Types.ObjectId();
    const originalId = new mongoose.Types.ObjectId();
    const importedId = new mongoose.Types.ObjectId();
    const duplicateId = new mongoose.Types.ObjectId();
    const originalPsa = {
      _id: originalId,
      studentId,
      requirementType: 'psa',
      status: 'approved',
      requirementStatus: 'reusable',
      fileName: 'original-psa.pdf',
      filePath: '',
      save: jest.fn().mockResolvedValue(true),
    };
    const importedPsa = {
      _id: importedId,
      studentId,
      requirementType: 'psa',
      sourceRequirementId: originalId,
      status: 'approved',
      fileName: 'imported-psa.pdf',
    };
    const duplicatePsa = { _id: duplicateId, studentId, requirementType: 'psa', filePath: '' };
    StudentRequirement.findOne.mockImplementation((filter) => {
      if (String(filter._id) === String(importedId)) return Promise.resolve(importedPsa);
      if (String(filter._id) === String(originalId)) return Promise.resolve(originalPsa);
      return mockQuery(null);
    });
    StudentRequirement.find.mockReturnValue(mockQuery([duplicatePsa]));

    const req = httpMocks.createRequest({
      body: {
        requirementType: 'psa',
        participationType: 'Intrams',
        replacementSubmissionId: String(importedId),
      },
      file: {
        buffer: Buffer.from('latest PSA bytes'),
        originalname: 'latest-psa.pdf',
        mimetype: 'application/pdf',
        size: 16,
      },
    });
    req.user = { _id: studentId, role: 'student' };
    const res = httpMocks.createResponse();

    await uploadRequirement(req, res);

    expect(res.statusCode).toBe(200);
    expect(String(res._getJSONData().data._id)).toBe(String(originalId));
    expect(originalPsa.fileName).toBe('latest-psa.pdf');
    expect(originalPsa.fileData).toEqual(Buffer.from('latest PSA bytes'));
    expect(originalPsa.status).toBe('pending');
    expect(originalPsa.save).toHaveBeenCalledTimes(1);
    expect(StudentRequirement).not.toHaveBeenCalled();
    expect(StudentRequirement.deleteMany).toHaveBeenCalledWith(expect.objectContaining({
      studentId,
      requirementType: 'psa',
      _id: { $ne: originalId },
    }));
    expect(StudentRequirement.deleteMany.mock.calls[0][0].$and).toEqual([
      { $or: [{ participationType: 'Intrams' }, { participationType: { $exists: false } }] },
    ]);
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
