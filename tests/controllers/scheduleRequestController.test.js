const httpMocks = require('node-mocks-http');
const { deleteScheduleRequest } = require('../../src/controllers/scheduleRequestController');
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
    const deletedRequest = { _id: requestId };
    const req = httpMocks.createRequest({ params: { id: requestId } });
    const res = httpMocks.createResponse();

    ScheduleRequest.findOneAndDelete.mockResolvedValue(deletedRequest);
    Schedule.findOneAndDelete.mockResolvedValue({ _id: '507f1f77bcf86cd799439012' });

    await deleteScheduleRequest(req, res);

    expect(ScheduleRequest.findOneAndDelete).toHaveBeenCalledWith({
      _id: requestId,
      status: 'approved'
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
});
