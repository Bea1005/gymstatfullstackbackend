const httpMocks = require('node-mocks-http');
const Requirement = require('../../src/models/Requirement');
const Announcement = require('../../src/models/Announcement');
const { publishRequirement } = require('../../src/controllers/requirementController');

jest.mock('../../src/models/Requirement', () => ({
  findById: jest.fn(),
}));

jest.mock('../../src/models/Announcement', () => {
  const announcementModel = jest.fn(function createAnnouncement(fields) {
    Object.assign(this, fields);
    this.save = announcementModel.save;
  });
  announcementModel.findOne = jest.fn();
  announcementModel.save = jest.fn();
  return announcementModel;
});

describe('publishRequirement', () => {
  const requirementId = '507f1f77bcf86cd799439011';
  let requirement;

  beforeEach(() => {
    jest.clearAllMocks();
    requirement = {
      _id: requirementId,
      title: 'Consent Form',
      description: 'Parent consent is required.',
      instructions: 'Complete and sign the form.',
      type: 'consent',
      dueDate: new Date('2026-10-29T00:00:00.000Z'),
      targetStudents: 'all',
      sport: 'General',
      status: 'draft',
      publishedAt: undefined,
      publishedBy: undefined,
      publish: jest.fn(async function publish(publisherId) {
        this.status = 'published';
        this.publishedAt = new Date('2026-09-29T00:00:00.000Z');
        this.publishedBy = publisherId;
      }),
      save: jest.fn().mockResolvedValue(true),
    };
    Requirement.findById.mockResolvedValue(requirement);
    Announcement.findOne.mockResolvedValue(null);
    Announcement.save.mockResolvedValue(true);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
    console.log.mockRestore();
  });

  const createRequest = () => httpMocks.createRequest({
    params: { id: requirementId },
    user: { _id: 'admin-id' },
  });

  it('publishes the requirement and creates an announcement with its real details', async () => {
    const res = httpMocks.createResponse();

    await publishRequirement(createRequest(), res);

    expect(res.statusCode).toBe(200);
    expect(requirement.publish).toHaveBeenCalledWith('admin-id');
    expect(Announcement).toHaveBeenCalledWith(expect.objectContaining({
      title: 'New Requirement: Consent Form',
      type: 'requirement',
      relatedRequirementId: requirementId,
      sport: 'General',
      createdBy: 'admin-id',
      description: expect.stringContaining('Due date: 2026-10-29'),
    }));
    expect(Announcement.mock.instances[0].description).toContain('Parent consent is required.');
    expect(Announcement.mock.instances[0].description).toContain('Instructions: Complete and sign the form.');
    expect(Announcement.mock.instances[0].description).toContain('Requirement type: consent');
    expect(Announcement.mock.instances[0].description).toContain('Target: All students');
    expect(Announcement.save).toHaveBeenCalledTimes(1);
  });

  it('does not create a duplicate announcement when the requirement is already published', async () => {
    requirement.status = 'published';
    Announcement.findOne.mockResolvedValue({ _id: 'existing-announcement' });
    const res = httpMocks.createResponse();

    await publishRequirement(createRequest(), res);

    expect(res.statusCode).toBe(200);
    expect(requirement.publish).not.toHaveBeenCalled();
    expect(Announcement).not.toHaveBeenCalled();
  });

  it('rolls a draft back and reports failure if its announcement cannot be saved', async () => {
    Announcement.save.mockRejectedValue(new Error('database write failed'));
    const res = httpMocks.createResponse();

    await publishRequirement(createRequest(), res);

    expect(res.statusCode).toBe(500);
    expect(res._getJSONData()).toMatchObject({ success: false });
    expect(requirement.status).toBe('draft');
    expect(requirement.publishedAt).toBeUndefined();
    expect(requirement.save).toHaveBeenCalledTimes(1);
  });
});