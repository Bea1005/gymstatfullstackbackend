const httpMocks = require('node-mocks-http');
const {
  deleteScheduleRequest,
  getPublicCalendarScheduleRequests,
  getScheduleRequests,
  downloadScheduleRequestFile,
  updateScheduleRequest
} = require('../../src/controllers/scheduleRequestController');
const ScheduleRequest = require('../../src/models/ScheduleRequest');
const Schedule = require('../../src/models/Schedule');
const { sendScheduleRequestStatusEmail } = require('../../src/config/email');

jest.mock('../../src/models/ScheduleRequest');
jest.mock('../../src/models/Schedule');
jest.mock('../../src/config/email', () => ({
  sendScheduleRequestStatusEmail: jest.fn()
}));
jest.mock('../../src/utils/withScheduleConflictLock', () => ({
  acquireScheduleConflictLock: jest.fn().mockResolvedValue(jest.fn())
}));
jest.mock('../../src/utils/scheduleConflicts', () => ({
  findScheduleConflict: jest.fn().mockResolvedValue(null)
}));

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

  describe('getScheduleRequests', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('excludes inline attachment data from the request list response', async () => {
      const requests = [{
        _id: 'request-id',
        eventName: 'Campus Event',
        requesterPhone: '09171234567',
        file: {
          filename: 'request.pdf',
          originalname: 'request.pdf',
          mimetype: 'application/pdf',
          storageKey: 'gridfs://file-id'
        }
      }];
      const query = {
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(requests)
      };
      ScheduleRequest.find.mockReturnValue(query);
      const req = httpMocks.createRequest({ query: {} });
      const res = httpMocks.createResponse();

      await getScheduleRequests(req, res);

      expect(query.select).toHaveBeenCalledWith('-file.data');
      expect(res.statusCode).toBe(200);
      expect(res._getJSONData().data[0]).toMatchObject({
        eventName: 'Campus Event',
        requesterPhone: '09171234567',
        file: { originalname: 'request.pdf', storageKey: 'gridfs://file-id' }
      });
    });

    describe('updateScheduleRequest requester notifications', () => {
      beforeEach(() => {
        jest.clearAllMocks();
      });

      const makePendingRequest = (id) => ({
        _id: id,
        status: 'pending',
        requesterName: 'Requester',
        requesterEmail: 'requester@example.com',
        requesterPhone: '09171234567',
        eventName: 'Campus Event',
        startDate: '2026-11-01',
        endDate: '2026-11-01',
        startTime: '08:00 AM',
        endTime: '12:00 PM',
        save: jest.fn().mockResolvedValue(undefined),
        toObject() {
          return Object.fromEntries(
            Object.entries(this).filter(([key]) => key !== 'save' && key !== 'toObject')
          );
        }
      });

      it('notifies the requester after a rejection is saved', async () => {
        const requestId = '507f1f77bcf86cd799439015';
        const request = makePendingRequest(requestId);
        ScheduleRequest.findById.mockResolvedValue(request);
        sendScheduleRequestStatusEmail.mockResolvedValue(undefined);
        const req = httpMocks.createRequest({
          params: { id: requestId },
          body: { status: 'rejected', rejectionReason: 'Schedule conflict' }
        });
        const res = httpMocks.createResponse();

        await updateScheduleRequest(req, res);

        expect(request.save).toHaveBeenCalled();
        expect(sendScheduleRequestStatusEmail).toHaveBeenCalledWith(
          'requester@example.com',
          expect.objectContaining({ status: 'rejected', rejectionReason: 'Schedule conflict' }),
          'rejected'
        );
        expect(res.statusCode).toBe(200);
        expect(res._getJSONData()).toMatchObject({ success: true, requesterNotified: true });
      });

      it('notifies the requester after approval and schedule creation', async () => {
        const requestId = '507f1f77bcf86cd799439017';
        const request = makePendingRequest(requestId);
        const schedule = {
          _id: '507f1f77bcf86cd799439018',
          save: jest.fn().mockResolvedValue(undefined)
        };
        ScheduleRequest.findById.mockResolvedValue(request);
        Schedule.findOne.mockResolvedValue(null);
        Schedule.mockImplementationOnce(() => schedule);
        sendScheduleRequestStatusEmail.mockResolvedValue(undefined);
        const req = httpMocks.createRequest({
          params: { id: requestId },
          body: { status: 'approved' }
        });
        const res = httpMocks.createResponse();

        await updateScheduleRequest(req, res);

        expect(schedule.save).toHaveBeenCalled();
        expect(request.save).toHaveBeenCalled();
        expect(sendScheduleRequestStatusEmail).toHaveBeenCalledWith(
          'requester@example.com',
          expect.objectContaining({ status: 'approved' }),
          'approved'
        );
        expect(res.statusCode).toBe(200);
        expect(res._getJSONData()).toMatchObject({ success: true, requesterNotified: true });
      });

      it('preserves a rejection if email delivery fails and reports the notification failure', async () => {
        const requestId = '507f1f77bcf86cd799439016';
        const request = makePendingRequest(requestId);
        ScheduleRequest.findById.mockResolvedValue(request);
        sendScheduleRequestStatusEmail.mockRejectedValue(new Error('Email provider unavailable'));
        const req = httpMocks.createRequest({
          params: { id: requestId },
          body: { status: 'rejected', rejectionReason: 'Schedule conflict' }
        });
        const res = httpMocks.createResponse();

        await updateScheduleRequest(req, res);

        expect(request.save).toHaveBeenCalled();
        expect(res.statusCode).toBe(200);
        expect(res._getJSONData()).toMatchObject({ success: true, requesterNotified: false });
      });
    });

    describe('downloadScheduleRequestFile', () => {
      beforeEach(() => {
        jest.clearAllMocks();
      });

      it('serves legacy inline attachment data through the existing download endpoint', async () => {
        const content = Buffer.from('legacy attachment');
        const query = {
          select: jest.fn().mockReturnThis(),
          lean: jest.fn().mockResolvedValue({
            file: {
              data: content.toString('base64'),
              originalname: 'request.pdf',
              mimetype: 'application/pdf'
            }
          })
        };
        ScheduleRequest.findById.mockReturnValue(query);
        const req = httpMocks.createRequest({ params: { id: 'request-id' } });
        const res = httpMocks.createResponse();

        await downloadScheduleRequestFile(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.getHeader('Content-Type')).toBe('application/pdf');
        expect(Buffer.from(res._getData())).toEqual(content);
      });
    });
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
    expect(query.select).toHaveBeenCalledWith('_id eventName requesterEmail startDate endDate startTime endTime prepDays status');
    expect(res._getJSONData().data).toEqual([{
      _id: 'pending-id',
      eventName: 'Campus Event',
      startDate: '2026-10-10',
      endDate: '2026-10-10',
      startTime: '08:00 AM',
      endTime: '12:00 PM',
      prepDays: 1,
      status: 'pending',
      clientType: 'External Client'
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
