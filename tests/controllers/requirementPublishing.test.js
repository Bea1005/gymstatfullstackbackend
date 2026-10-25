const httpMocks = require('node-mocks-http');
const Requirement = require('../../src/models/Requirement');
const RequirementSubmission = require('../../src/models/RequirementSubmission');
const Announcement = require('../../src/models/Announcement');
const {
  publishRequirement,
  updateRequirement,
  getPublishedRequirements
} = require('../../src/controllers/requirementController');

jest.mock('../../src/models/Requirement', () => ({
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  find: jest.fn(),
}));

jest.mock('../../src/models/RequirementSubmission', () => ({
  find: jest.fn(),
}));

jest.mock('../../src/models/Announcement', () => {
  const announcementModel = jest.fn(function createAnnouncement(fields) {
    Object.assign(this, fields);
    this.save = announcementModel.save;
  });
  announcementModel.findOne = jest.fn();
  announcementModel.findOneAndUpdate = jest.fn();
  announcementModel.save = jest.fn();
  return announcementModel;
});

describe('publishRequirement', () => {
  const requirementId = '507f1f77bcf86cd799439011';
  let requirement;

  beforeEach(() => {
    jest.clearAllMocks();
    RequirementSubmission.find.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([])
      })
    });
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
      isActive: true,
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

  it('publishes a custom student requirement and confirms its saved published state', async () => {
    requirement.title = 'Athlete Medical Clearance';
    requirement.description = 'Submit current clearance details.';
    requirement.instructions = 'Upload a readable document.';
    requirement.type = 'other';
    requirement.targetStudents = 'sport-specific';
    requirement.sport = 'Volleyball';
    const res = httpMocks.createResponse();

    await publishRequirement(createRequest(), res);

    expect(res.statusCode).toBe(200);
    expect(res._getJSONData()).toMatchObject({
      success: true,
      data: {
        title: 'Athlete Medical Clearance',
        type: 'other',
        status: 'published',
        isActive: true
      }
    });
    expect(Announcement).toHaveBeenCalledWith(expect.objectContaining({
      title: 'New Requirement: Athlete Medical Clearance',
      sport: 'Volleyball',
      description: expect.stringContaining('Submit current clearance details.')
    }));
    expect(Announcement.mock.instances[0].description).toContain('Target: Students in Volleyball');
    expect(Announcement.mock.instances[0].description).toContain('Instructions: Upload a readable document.');
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

  it('updates the existing announcement when an active published requirement changes', async () => {
    const updatedRequirement = {
      _id: requirementId,
      title: 'Updated Consent Form',
      description: 'Updated parent consent details.',
      instructions: 'Use the revised form.',
      type: 'consent',
      dueDate: new Date('2026-11-10T00:00:00.000Z'),
      targetStudents: 'all',
      sport: 'General',
      status: 'published',
      isActive: true,
    };
    Requirement.findByIdAndUpdate.mockResolvedValue(updatedRequirement);
    Announcement.findOneAndUpdate.mockResolvedValue({ _id: 'existing-announcement' });
    const req = httpMocks.createRequest({
      params: { id: requirementId },
      body: { title: updatedRequirement.title },
    });
    const res = httpMocks.createResponse();

    await updateRequirement(req, res);

    expect(res.statusCode).toBe(200);
    expect(Announcement.findOneAndUpdate).toHaveBeenCalledWith(
      { relatedRequirementId: requirementId },
      expect.objectContaining({
        title: 'Updated Requirement: Updated Consent Form',
        type: 'requirement',
        description: expect.stringContaining('Updated parent consent details.'),
      })
    );
    expect(Announcement).not.toHaveBeenCalled();
  });

  it('returns all-sports and exact multi-sport matches from the authenticated student sports', async () => {
    const assignedDefinition = {
      _id: requirementId,
      type: 'other',
      title: 'Volleyball Clearance',
      status: 'published',
      isActive: true,
      targetStudents: 'sport-specific',
      sport: 'Basketball (Men) | Volleyball (Women)',
    };
    const allSportsDefinition = {
      _id: 'all-sports-id',
      type: 'other',
      title: 'All Sports Form',
      status: 'published',
      isActive: true,
      targetStudents: 'all',
      sport: 'General',
    };
    const unrelatedDefinition = {
      _id: 'unrelated-sport-id',
      type: 'other',
      title: 'Badminton Form',
      status: 'published',
      isActive: true,
      targetStudents: 'sport-specific',
      sport: 'Badminton (Men)',
    };
    const query = {
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([assignedDefinition, allSportsDefinition, unrelatedDefinition]),
    };
    Requirement.find.mockReturnValue(query);
    const req = httpMocks.createRequest({
      query: { sport: 'Badminton (Men)' },
      user: {
        _id: 'student-id',
        role: 'student',
        sport: 'Basketball (Women)',
        sports: ['Volleyball (Women)']
      },
    });
    const res = httpMocks.createResponse();

    await getPublishedRequirements(req, res);

    expect(Requirement.find).toHaveBeenCalledWith({
      status: 'published',
      isActive: true,
    });
    expect(res.statusCode).toBe(200);
    expect(res._getJSONData().data.map(({ title }) => title)).toEqual([
      'Volleyball Clearance',
      'All Sports Form'
    ]);
    expect(res._getJSONData().data[0].submissionStatus).toBe('not-submitted');
  });
});