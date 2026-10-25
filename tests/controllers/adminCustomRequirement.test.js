const httpMocks = require('node-mocks-http');
const Requirement = require('../../src/models/Requirement');
const {
  createRequirement,
  updateRequirement
} = require('../../src/controllers/requirementController');
const uploadedFileStorage = require('../../src/config/uploadedFileStorage');

jest.mock('../../src/models/Requirement', () => {
  const mockRequirement = jest.fn(function createRequirement(data) {
    Object.assign(this, data);
    this.save = mockRequirement.save;
  });
  mockRequirement.save = jest.fn();
  mockRequirement.findByIdAndUpdate = jest.fn();
  return mockRequirement;
});

jest.mock('../../src/config/uploadedFileStorage', () => ({
  storeUploadedFile: jest.fn(),
  deleteStoredUpload: jest.fn(),
  getGridFsId: jest.fn(),
  resolveLegacyUploadPath: jest.fn(),
  streamUploadFile: jest.fn(),
  removeLegacyPathFromResponse: jest.fn((value) => value),
}));

describe('admin custom requirement definitions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Requirement.save.mockResolvedValue(true);
    Requirement.findByIdAndUpdate.mockResolvedValue(null);
    uploadedFileStorage.storeUploadedFile.mockResolvedValue({
      reference: 'gridfs:custom-requirement',
      filename: 'custom-requirement.pdf'
    });
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.log.mockRestore();
    console.error.mockRestore();
  });

  it('saves a fileless custom requirement definition as a draft', async () => {
    const req = httpMocks.createRequest({
      method: 'POST',
      body: {
        title: 'Updated Medical Clearance',
        description: 'Submit an updated medical clearance.',
        instructions: 'Upload a readable PDF.',
        type: 'other',
        sport: 'Basketball',
        targetStudents: 'sport-specific',
        dueDate: '2026-10-29T00:00:00.000Z',
        isActive: true
      },
      user: { _id: 'admin-id' }
    });
    const res = httpMocks.createResponse();

    await createRequirement(req, res);

    expect(res.statusCode).toBe(201);
    expect(Requirement).toHaveBeenCalledTimes(1);
    expect(Requirement.mock.calls[0][0]).toMatchObject({
      title: 'Updated Medical Clearance',
      description: 'Submit an updated medical clearance.',
      instructions: 'Upload a readable PDF.',
      type: 'other',
      sport: 'Basketball',
      targetStudents: 'sport-specific',
      status: 'draft',
      isActive: true
    });
    expect(Requirement.mock.calls[0][0]).not.toHaveProperty('file');
    expect(Requirement.save).toHaveBeenCalledTimes(1);
    expect(res._getJSONData()).toMatchObject({
      success: true,
      message: 'Requirement created successfully'
    });
  });

  it('persists multiple selected sports in the existing sport field', async () => {
    const sportScope = 'Basketball (Men) | Volleyball (Women)';
    const req = httpMocks.createRequest({
      method: 'POST',
      body: {
        title: 'Team Clearance',
        type: 'other',
        sport: sportScope,
        targetStudents: 'sport-specific',
        dueDate: '2026-10-29T00:00:00.000Z',
        isActive: true
      },
      user: { _id: 'admin-id' }
    });
    const res = httpMocks.createResponse();

    await createRequirement(req, res);

    expect(res.statusCode).toBe(201);
    expect(Requirement.mock.calls[0][0]).toMatchObject({
      title: 'Team Clearance',
      sport: sportScope,
      targetStudents: 'sport-specific'
    });
  });

  it('persists All Sports using the existing all-students scope', async () => {
    const req = httpMocks.createRequest({
      method: 'POST',
      body: {
        title: 'General Clearance',
        type: 'other',
        sport: 'General',
        targetStudents: 'all',
        dueDate: '2026-10-29T00:00:00.000Z',
        isActive: true
      },
      user: { _id: 'admin-id' }
    });
    const res = httpMocks.createResponse();

    await createRequirement(req, res);

    expect(res.statusCode).toBe(201);
    expect(Requirement.mock.calls[0][0]).toMatchObject({
      title: 'General Clearance',
      sport: 'General',
      targetStudents: 'all'
    });
  });

  it('preserves an optional file attached to a custom requirement', async () => {
    const file = {
      buffer: Buffer.from('custom requirement file'),
      originalname: 'instructions.pdf',
      mimetype: 'application/pdf',
      size: 23
    };
    const req = httpMocks.createRequest({
      method: 'POST',
      body: {
        title: 'Updated Medical Clearance',
        type: 'other',
        dueDate: '2026-10-29T00:00:00.000Z',
        isActive: true
      },
      file,
      user: { _id: 'admin-id' }
    });
    const res = httpMocks.createResponse();

    await createRequirement(req, res);

    expect(res.statusCode).toBe(201);
    expect(uploadedFileStorage.storeUploadedFile).toHaveBeenCalledWith(expect.objectContaining({
      buffer: file.buffer,
      filename: file.originalname,
      contentType: file.mimetype
    }));
    expect(Requirement.mock.calls[0][0].file).toMatchObject({
      filename: 'custom-requirement.pdf',
      originalname: 'instructions.pdf',
      mimetype: 'application/pdf',
      size: 23,
      path: 'gridfs:custom-requirement'
    });
  });

  it('allows non-custom requirement definitions without an attached file', async () => {
    const req = httpMocks.createRequest({
      method: 'POST',
      body: {
        title: 'Consent Form',
        type: 'consent',
        dueDate: '2026-10-29T00:00:00.000Z'
      }
    });
    const res = httpMocks.createResponse();

    await createRequirement(req, res);

    expect(res.statusCode).toBe(201);
    expect(Requirement).toHaveBeenCalledTimes(1);
    expect(Requirement.mock.calls[0][0]).toMatchObject({
      title: 'Consent Form',
      type: 'consent',
      status: 'draft'
    });
    expect(Requirement.mock.calls[0][0]).not.toHaveProperty('file');
  });

  it('archives a custom definition without deleting its record or student submissions', async () => {
    const requirementId = '507f1f77bcf86cd799439011';
    Requirement.findByIdAndUpdate.mockResolvedValue({
      _id: requirementId,
      title: 'Updated Medical Clearance',
      type: 'other',
      status: 'archived',
      isActive: false
    });
    const req = httpMocks.createRequest({
      method: 'PUT',
      params: { id: requirementId },
      body: { status: 'archived', isActive: false }
    });
    const res = httpMocks.createResponse();

    await updateRequirement(req, res);

    expect(Requirement.findByIdAndUpdate).toHaveBeenCalledWith(
      requirementId,
      expect.objectContaining({ status: 'archived', isActive: false }),
      { new: true, runValidators: true }
    );
    expect(res.statusCode).toBe(200);
    expect(res._getJSONData().data).toMatchObject({ status: 'archived', isActive: false });
  });

  it('allows an archived custom definition to be edited and republished', async () => {
    const requirementId = '507f1f77bcf86cd799439011';
    Requirement.findByIdAndUpdate.mockResolvedValue({
      _id: requirementId,
      title: 'New Clearance Name',
      type: 'other',
      status: 'published',
      isActive: true
    });
    const req = httpMocks.createRequest({
      method: 'PUT',
      params: { id: requirementId },
      body: {
        title: 'New Clearance Name',
        type: 'other',
        status: 'published',
        isActive: true
      }
    });
    const res = httpMocks.createResponse();

    await updateRequirement(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._getJSONData().data).toMatchObject({ title: 'New Clearance Name', status: 'published' });
  });
});
