const express = require('express');
const request = require('supertest');
const ScheduleRequest = require('../../src/models/ScheduleRequest');
const { protect, authorize } = require('../../src/middleware/auth');
const scheduleRequestRoutes = require('../../src/routes/scheduleRequests');

jest.mock('../../src/models/ScheduleRequest', () => ({
  find: jest.fn()
}));
jest.mock('../../src/models/Schedule', () => ({}));
jest.mock('../../src/middleware/auth', () => ({
  protect: jest.fn((req, res, next) => next()),
  authorize: jest.fn(() => (req, res, next) => next()),
}));

describe('Public schedule-request calendar route', () => {
  let app;

  beforeEach(() => {
    protect.mockClear();
    ScheduleRequest.find.mockClear();
    app = express();
    app.use('/api/v1/schedule-requests', scheduleRequestRoutes);
    ScheduleRequest.find.mockReturnValue({
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
        requesterPhone: '09171234567',
        file: { storageKey: 'private-file' },
      }]),
    });
  });

  it('serves only pending calendar fields without Admin authentication', async () => {
    const adminAuthorizationSetupCount = authorize.mock.calls.length;
    const response = await request(app)
      .get('/api/v1/schedule-requests/public-calendar?startDate=2026-10-01&endDate=2026-10-31');

    expect(response.status).toBe(200);
    expect(response.body.data[0]).toEqual({
      _id: 'pending-id',
      eventName: 'Campus Event',
      startDate: '2026-10-10',
      endDate: '2026-10-10',
      startTime: '08:00 AM',
      endTime: '12:00 PM',
      prepDays: 1,
      status: 'pending',
      clientType: 'External Client',
    });
    expect(protect).not.toHaveBeenCalled();
    expect(authorize).toHaveBeenCalledTimes(adminAuthorizationSetupCount);
  });

  it('keeps the existing all-requests endpoint behind Admin middleware', async () => {
    await request(app).get('/api/v1/schedule-requests');

    expect(protect).toHaveBeenCalledTimes(1);
    expect(authorize).toHaveBeenCalledWith('admin');
  });

  it('rejects unauthenticated schedule submissions before processing the upload', async () => {
    protect.mockImplementationOnce((req, res) => res.status(401).json({
      success: false,
      message: 'Not authorized',
    }));

    const response = await request(app)
      .post('/api/v1/schedule-requests')
      .field('eventName', 'Campus Event');

    expect(response.status).toBe(401);
    expect(protect).toHaveBeenCalledTimes(1);
  });

  it('rejects a request when authentication middleware does not provide a user', async () => {
    const response = await request(app)
      .post('/api/v1/schedule-requests')
      .field('eventName', 'Campus Event');

    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/authenticated account/i);
  });

  it('rejects an authenticated requester who has not completed their profile', async () => {
    protect.mockImplementationOnce((req, res, next) => {
      req.user = {
        email: 'requester@example.com',
        emailVerified: true,
        fullname: 'Jane Doe',
        contactNumber: '',
      };
      next();
    });

    const response = await request(app)
      .post('/api/v1/schedule-requests')
      .field('eventName', 'Campus Event');

    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/complete your profile/i);
  });
});