const httpMocks = require('node-mocks-http');
const { validateScheduleRequest } = require('../../src/middleware/scheduleRequestValidation');

describe('schedule request date/time validation', () => {
  const createRequest = (startDate) => httpMocks.createRequest({
    file: { originalname: 'request.pdf' },
    body: {
      eventName: 'Campus Event',
      requesterName: 'Jane Doe',
      requesterEmail: 'jane@example.com',
      requesterPhone: '09171234567',
      startDate,
      startTime: '08:00 AM',
      endDate: startDate,
      endTime: '10:00 AM',
      prepDays: 0,
      formStartedAt: Date.now() - 2000,
    }
  });

  it('rejects a public request for a past date', () => {
    const req = createRequest('2000-01-01');
    const res = httpMocks.createResponse();
    const next = jest.fn();

    validateScheduleRequest(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res._getJSONData().message).toContain('Past dates');
    expect(next).not.toHaveBeenCalled();
  });
});
