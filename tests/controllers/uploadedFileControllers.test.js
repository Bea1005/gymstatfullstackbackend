const httpMocks = require('node-mocks-http');
const Schedule = require('../../src/models/Schedule');
const ScheduleRequest = require('../../src/models/ScheduleRequest');
const Requirement = require('../../src/models/Requirement');
const { findScheduleConflict } = require('../../src/utils/scheduleConflicts');
const {
  storeUploadedFile,
  deleteStoredUpload,
  streamUploadFile,
} = require('../../src/config/uploadedFileStorage');
const {
  createScheduleRequest,
  downloadScheduleRequestFile,
} = require('../../src/controllers/scheduleRequestController');
const {
  createRequirement,
  deleteRequirement,
  downloadRequirement,
} = require('../../src/controllers/requirementController');

jest.mock('../../src/models/Schedule', () => ({ findById: jest.fn() }));
jest.mock('../../src/models/ScheduleRequest', () => {
  const Model = jest.fn(function createDocument(data) {
    Object.assign(this, data);
    this._id = 'schedule-request-id';
    this.save = jest.fn().mockResolvedValue(this);
  });
  Model.findOne = jest.fn();
  Model.findById = jest.fn();
  return Model;
});
jest.mock('../../src/models/Requirement', () => {
  const Model = jest.fn(function createDocument(data) {
    Object.assign(this, data);
    this._id = 'requirement-id';
    this.save = jest.fn().mockResolvedValue(this);
  });
  Model.findById = jest.fn();
  Model.findByIdAndDelete = jest.fn();
  return Model;
});
jest.mock('../../src/models/RequirementSubmission', () => ({ deleteMany: jest.fn().mockResolvedValue({}) }));
jest.mock('../../src/models/Announcement', () => ({ deleteMany: jest.fn().mockResolvedValue({}) }));
jest.mock('../../src/utils/scheduleConflicts', () => ({ findScheduleConflict: jest.fn() }));
jest.mock('../../src/utils/withScheduleConflictLock', () => ({ acquireScheduleConflictLock: jest.fn() }));
jest.mock('../../src/config/uploadedFileStorage', () => ({
  storeUploadedFile: jest.fn(),
  deleteStoredUpload: jest.fn(),
  getGridFsId: jest.fn((value) => String(value || '').startsWith('gridfs://') ? 'file-id' : null),
  resolveLegacyUploadPath: jest.fn(() => ''),
  streamUploadFile: jest.fn(),
  removeLegacyPathFromResponse: jest.fn((record) => record),
}));

const pdfFile = {
  buffer: Buffer.from('%PDF-1.7 test file'),
  originalname: 'attachment.pdf',
  mimetype: 'application/pdf',
  size: 18,
};

const mockDuplicateLookup = (result = null) => ScheduleRequest.findOne.mockReturnValue({
  select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(result) }),
});

describe('persistent file controller integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDuplicateLookup();
    findScheduleConflict.mockResolvedValue(null);
    storeUploadedFile.mockResolvedValue({
      id: '64b000000000000000000001',
      reference: 'gridfs://64b000000000000000000001',
      filename: 'attachment.pdf',
    });
    deleteStoredUpload.mockResolvedValue(true);
    streamUploadFile.mockResolvedValue(true);
  });

  it('stores schedule request attachment bytes in GridFS and persists its key', async () => {
    const req = httpMocks.createRequest({
      body: {
        eventName: 'Meet',
        requesterName: 'Person',
        requesterEmail: 'person@example.com',
        requesterPhone: '09123456789',
        startDate: '2030-01-01',
        endDate: '2030-01-01',
        startTime: '8:00 AM',
        endTime: '9:00 AM',
      },
      file: pdfFile,
    });
    const res = httpMocks.createResponse();

    await createScheduleRequest(req, res);

    expect(res.statusCode).toBe(201);
    expect(storeUploadedFile).toHaveBeenCalledWith(expect.objectContaining({
      buffer: pdfFile.buffer,
      contentType: pdfFile.mimetype,
      metadata: { purpose: 'schedule-request-attachment' },
    }));
    expect(ScheduleRequest.mock.instances[0].file.storageKey).toBe('gridfs://64b000000000000000000001');
    expect(ScheduleRequest.mock.instances[0].file.size).toBe(pdfFile.size);
  });

  it('does not store a schedule request attachment when its time conflicts', async () => {
    findScheduleConflict.mockResolvedValue({ _id: 'conflicting-schedule' });
    const req = httpMocks.createRequest({
      body: {
        eventName: 'Meet',
        requesterName: 'Person',
        requesterEmail: 'person@example.com',
        requesterPhone: '09123456789',
        startDate: '2030-01-01',
        endDate: '2030-01-01',
        startTime: '8:00 AM',
        endTime: '9:00 AM',
      },
      file: pdfFile,
    });
    const res = httpMocks.createResponse();

    await createScheduleRequest(req, res);

    expect(res.statusCode).toBe(409);
    expect(storeUploadedFile).not.toHaveBeenCalled();
  });

  it('downloads a schedule request attachment through the existing admin route handler', async () => {
    const request = { file: { storageKey: 'gridfs://stored-id', originalname: 'letter.pdf' } };
    ScheduleRequest.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(request) }),
    });
    const req = httpMocks.createRequest({ params: { id: 'schedule-request-id' } });
    const res = httpMocks.createResponse();

    await downloadScheduleRequestFile(req, res);

    expect(res.statusCode).toBe(200);
    expect(streamUploadFile).toHaveBeenCalledWith('gridfs://stored-id', res, expect.objectContaining({
      filename: 'letter.pdf',
    }));
  });

  it('returns a safe 404 when a schedule request GridFS file is missing', async () => {
    ScheduleRequest.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ file: { storageKey: 'gridfs://missing-id' } }),
      }),
    });
    streamUploadFile.mockResolvedValue(false);
    const req = httpMocks.createRequest({ params: { id: 'schedule-request-id' } });
    const res = httpMocks.createResponse();

    await downloadScheduleRequestFile(req, res);

    expect(res.statusCode).toBe(404);
    expect(res._getJSONData().message).toBe('File not found');
  });

  it('stores admin requirement files using a GridFS reference in the existing file.path field', async () => {
    const req = httpMocks.createRequest({
      body: { title: 'Medical', type: 'medical', dueDate: '2030-01-01' },
      file: pdfFile,
      user: { _id: 'admin-id' },
    });
    const res = httpMocks.createResponse();

    await createRequirement(req, res);

    expect(res.statusCode).toBe(201);
    expect(storeUploadedFile).toHaveBeenCalledWith(expect.objectContaining({
      buffer: pdfFile.buffer,
      metadata: { purpose: 'admin-requirement' },
    }));
    expect(Requirement.mock.instances[0].file.path).toBe('gridfs://64b000000000000000000001');
    expect(Requirement.mock.instances[0].file.size).toBe(pdfFile.size);
  });

  it('downloads an admin requirement file by its stored GridFS reference', async () => {
    Requirement.findById.mockResolvedValue({
      file: {
        path: 'gridfs://stored-id',
        filename: 'attachment.pdf',
        originalname: 'attachment.pdf',
        mimetype: 'application/pdf',
      },
    });
    const req = httpMocks.createRequest({ params: { id: 'requirement-id' } });
    const res = httpMocks.createResponse();

    await downloadRequirement(req, res);

    expect(res.statusCode).toBe(200);
    expect(streamUploadFile).toHaveBeenCalledWith('gridfs://stored-id', res, expect.objectContaining({
      filename: 'attachment.pdf',
      contentType: 'application/pdf',
    }));
  });

  it('returns a safe 404 when an Admin Requirement GridFS file is missing', async () => {
    Requirement.findById.mockResolvedValue({
      file: { path: 'gridfs://missing-id', filename: 'attachment.pdf' },
    });
    streamUploadFile.mockResolvedValue(false);
    const req = httpMocks.createRequest({ params: { id: 'requirement-id' } });
    const res = httpMocks.createResponse();

    await downloadRequirement(req, res);

    expect(res.statusCode).toBe(404);
    expect(res._getJSONData().message).toBe('File not found');
  });

  it('deletes an admin requirement GridFS file when its requirement is deleted', async () => {
    Requirement.findById.mockResolvedValue({
      _id: 'requirement-id',
      file: { path: 'gridfs://stored-id', filename: 'attachment.pdf' },
    });
    Requirement.findByIdAndDelete.mockResolvedValue({ _id: 'requirement-id' });
    const req = httpMocks.createRequest({ params: { id: 'requirement-id' } });
    const res = httpMocks.createResponse();

    await deleteRequirement(req, res);

    expect(res.statusCode).toBe(200);
    expect(deleteStoredUpload).toHaveBeenCalledWith('gridfs://stored-id');
  });
});
