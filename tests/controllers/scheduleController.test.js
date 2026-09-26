const httpMocks = require('node-mocks-http');
const Schedule = require('../../src/models/Schedule');
const { findScheduleConflict } = require('../../src/utils/scheduleConflicts');
const { acquireScheduleConflictLock } = require('../../src/utils/withScheduleConflictLock');
const { updateSchedule } = require('../../src/controllers/scheduleController');

jest.mock('../../src/models/Schedule', () => ({
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn()
}));
jest.mock('../../src/utils/scheduleConflicts', () => ({
  findScheduleConflict: jest.fn()
}));
jest.mock('../../src/utils/withScheduleConflictLock', () => ({
  acquireScheduleConflictLock: jest.fn()
}));

describe('updateSchedule', () => {
  const scheduleId = '507f1f77bcf86cd799439011';
  const currentSchedule = {
    _id: scheduleId,
    event: 'Practice A',
    startDate: '2026-10-01',
    endDate: '2026-10-01',
    startTime: '8:00 AM',
    endTime: '10:00 AM',
    prepDays: 0,
    status: 'active'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    acquireScheduleConflictLock.mockResolvedValue(jest.fn().mockResolvedValue());
    Schedule.findById.mockResolvedValue({ ...currentSchedule });
    Schedule.findByIdAndUpdate.mockImplementation(async (_id, update) => ({
      ...currentSchedule,
      ...update
    }));
    findScheduleConflict.mockResolvedValue(null);
  });

  it('updates a schedule when the edited time does not overlap another active schedule', async () => {
    const req = httpMocks.createRequest({
      params: { id: scheduleId },
      body: { startTime: '8:00 AM', endTime: '9:00 AM' }
    });
    const res = httpMocks.createResponse();

    await updateSchedule(req, res);

    expect(res.statusCode).toBe(200);
    expect(findScheduleConflict).toHaveBeenCalledWith(
      Schedule,
      expect.objectContaining({ startTime: '8:00 AM', endTime: '9:00 AM' }),
      scheduleId
    );
    expect(Schedule.findByIdAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('rejects an overlapping edit and leaves the schedule unchanged', async () => {
    findScheduleConflict.mockResolvedValue({ _id: 'another-schedule' });
    const req = httpMocks.createRequest({
      params: { id: scheduleId },
      body: { startTime: '9:00 AM', endTime: '11:00 AM' }
    });
    const res = httpMocks.createResponse();

    await updateSchedule(req, res);

    expect(res.statusCode).toBe(409);
    expect(res._getJSONData().message).toContain('overlaps');
    expect(Schedule.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('checks the schedule against others while excluding its own MongoDB id', async () => {
    const req = httpMocks.createRequest({
      params: { id: scheduleId },
      body: { startTime: '8:00 AM', endTime: '10:00 AM' }
    });
    const res = httpMocks.createResponse();

    await updateSchedule(req, res);

    expect(res.statusCode).toBe(200);
    expect(findScheduleConflict).toHaveBeenCalledWith(
      Schedule,
      expect.objectContaining({ _id: scheduleId }),
      scheduleId
    );
  });

  it('does not conflict-check a schedule edited to a non-active status', async () => {
    const req = httpMocks.createRequest({
      params: { id: scheduleId },
      body: { status: 'cancelled' }
    });
    const res = httpMocks.createResponse();

    await updateSchedule(req, res);

    expect(res.statusCode).toBe(200);
    expect(findScheduleConflict).not.toHaveBeenCalled();
    expect(Schedule.findByIdAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('serializes conflict checking and updating through the shared lock', async () => {
    const req = httpMocks.createRequest({
      params: { id: scheduleId },
      body: { endTime: '9:00 AM' }
    });
    const res = httpMocks.createResponse();
    const releaseLock = jest.fn().mockResolvedValue();
    acquireScheduleConflictLock.mockResolvedValue(releaseLock);

    await updateSchedule(req, res);

    expect(acquireScheduleConflictLock).toHaveBeenCalledTimes(1);
    expect(findScheduleConflict).toHaveBeenCalled();
    expect(Schedule.findByIdAndUpdate).toHaveBeenCalled();
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });
});