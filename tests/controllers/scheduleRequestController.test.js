const httpMocks = require('node-mocks-http');
const {
  deleteScheduleRequest,
  getPublicCalendarScheduleRequests
} = require('../../src/controllers/scheduleRequestController');
const ScheduleRequest = require('../../src/models/ScheduleRequest');
const Schedule = require('../../src/models/Schedule');

jest.mock('../../src/models/ScheduleRequest');
jest.mock('../../src/models/Schedule');

describe('Schedule request deletion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deletes only an approved request and its linked schedule', async () => {
    const requestId = '507f1f77bcf86cd799439011';
    const deletedRequest = { _id: requestId, status: 'approved' };
    const req = httpMocks.createRequest({ params: { id: requestId } });
    const res = httpMocks.createResponse();

    ScheduleRequest.findOneAndDelete.mockResolvedValue(deletedRequest);
    Schedule.findOneAndDelete.mockResolvedValue({ _id: '507f1f77bcf86cd799439012' });

    await deleteScheduleRequest(req, res);

    expect(ScheduleRequest.findOneAndDelete).toHaveBeenCalledWith({
      _id: requestId,
      status: { $in: ['approved', 'rejected'] }
    });
    expect(Schedule.findOneAndDelete).toHaveBeenCalledWith({ fromRequest: requestId });
    expect(res.statusCode).toBe(200);
    expect(res._getJSONData()).toMatchObject({ success: true, data: { scheduleDeleted: true } });
  });

  it('does not delete a linked schedule when the request is missing', async () => {
    const requestId = '507f1f77bcf86cd799439013';
    const req = httpMocks.createRequest({ params: { id: requestId } });
    const res = httpMocks.createResponse();

    ScheduleRequest.findOneAndDelete.mockResolvedValue(null);

    await deleteScheduleRequest(req, res);

    expect(Schedule.findOneAndDelete).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(404);
  });

  it('deletes a rejected request without touching schedules', async () => {
    const requestId = '507f1f77bcf86cd799439014';
    const req = httpMocks.createRequest({ params: { id: requestId } });
    const res = httpMocks.createResponse();

    ScheduleRequest.findOneAndDelete.mockResolvedValue({ _id: requestId, status: 'rejected' });

    await deleteScheduleRequest(req, res);

    expect(res.statusCode).toBe(200);
    expect(Schedule.findOneAndDelete).not.toHaveBeenCalled();
    expect(res._getJSONData()).toMatchObject({ success: true, data: { scheduleDeleted: false } });
  });
});

describe('getPublicCalendarScheduleRequests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns only pending calendar fields for the requested date range', async () => {
    const query = {
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{
        _id: 'pending-id',
        eventName: 'Campus Event',
        startDate: '2026-10-10',
        endDate: '2026-10-10',
        startTime: '08:00 AM',
        endTime: '12:00 PM',
        prepDays: 1,
        status: 'pending',
        requesterName: 'Private Name',
        requesterEmail: 'private@example.com',
        file: { storageKey: 'private-file' }
      }])
    };
    ScheduleRequest.find.mockReturnValue(query);
    const req = httpMocks.createRequest({
      query: { startDate: '2026-10-01', endDate: '2026-10-31' }
    });
    const res = httpMocks.createResponse();

    await getPublicCalendarScheduleRequests(req, res);

    expect(ScheduleRequest.find).toHaveBeenCalledWith({
      status: 'pending',
      startDate: { $lte: '2026-11-30' },
      endDate: { $gte: '2026-10-01' }
    });
    expect(query.select).toHaveBeenCalledWith('_id eventName startDate endDate startTime endTime prepDays status');
    expect(res._getJSONData().data).toEqual([{
      _id: 'pending-id',
      eventName: 'Campus Event',
      startDate: '2026-10-10',
      endDate: '2026-10-10',
      startTime: '08:00 AM',
      endTime: '12:00 PM',
      prepDays: 1,
      status: 'pending'
    }]);
  });

  it('rejects invalid date ranges without querying MongoDB', async () => {
    const req = httpMocks.createRequest({
      query: { startDate: '2026-10-31', endDate: '2026-10-01' }
    });
    const res = httpMocks.createResponse();

    await getPublicCalendarScheduleRequests(req, res);

    expect(res.statusCode).toBe(400);
    expect(ScheduleRequest.find).not.toHaveBeenCalled();
  });
});
