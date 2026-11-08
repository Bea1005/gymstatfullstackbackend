jest.mock('../../src/middleware/auth', () => ({
  protect: jest.fn((_req, _res, next) => next()),
  authorize: jest.fn(() => (_req, _res, next) => next()),
}));

jest.mock('../../src/models/User', () => ({
  collection: { name: 'users' },
  countDocuments: jest.fn(),
  find: jest.fn(),
}));

jest.mock('../../src/models/StudentAthlete', () => ({
  collection: { name: 'studentathletes' },
  aggregate: jest.fn(),
  countDocuments: jest.fn(),
}));

jest.mock('../../src/models/Equipment', () => ({
  collection: { name: 'equipments' },
  countDocuments: jest.fn(),
}));

jest.mock('../../src/models/Borrowing', () => ({
  countDocuments: jest.fn(),
  aggregate: jest.fn(),
}));

jest.mock('../../src/models/ScheduleRequest', () => ({
  countDocuments: jest.fn(),
}));

jest.mock('../../src/models/Schedule', () => ({
  find: jest.fn(),
}));

const User = require('../../src/models/User');
const StudentAthlete = require('../../src/models/StudentAthlete');
const Equipment = require('../../src/models/Equipment');
const Borrowing = require('../../src/models/Borrowing');
const ScheduleRequest = require('../../src/models/ScheduleRequest');
const Schedule = require('../../src/models/Schedule');
const router = require('../../src/routes/adminRoutes');

describe('admin dashboard analytics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns period-filtered analytics with historical counts, borrower types, and trends', async () => {
    User.countDocuments
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(3);
    User.find.mockReturnValue({
      sort: () => ({
        limit: () => ({
          select: async () => [{ _id: 'admin-user', fullname: 'Admin', role: 'admin', createdAt: new Date() }],
        }),
      }),
    });
    Equipment.countDocuments.mockResolvedValue(5);
    Borrowing.countDocuments.mockResolvedValue(2);
    ScheduleRequest.countDocuments.mockResolvedValue(0);
    StudentAthlete.aggregate
      .mockResolvedValueOnce([{ department: 'CICS', count: 4 }])
      .mockResolvedValueOnce([{ period: '2026-11', count: 4 }]);
    StudentAthlete.countDocuments
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(12);
    Borrowing.aggregate
      .mockResolvedValueOnce([{ department: 'CICS', count: 3 }])
      .mockResolvedValueOnce([{
        equipment: 'Basketball',
        count: 5,
        transactions: 3,
        referenceIdCount: 5,
      }])
      .mockResolvedValueOnce([{
        borrowerType: 'Student',
        count: 3,
        transactions: 3,
        borrowers: 2,
      }])
      .mockResolvedValueOnce([{ period: '2026-11', count: 2 }])
      .mockResolvedValueOnce([{ period: '2026-11', count: 5 }]);
    Schedule.find.mockReturnValue({
      sort: () => ({
        limit: () => ({
          lean: async () => [],
        }),
      }),
    });

    const routeLayer = router.stack.find((layer) => layer.route?.path === '/admin/dashboard');
    const handlers = routeLayer.route.stack;
    const handler = handlers[handlers.length - 1].handle;
    const req = { query: { period: 'monthly', date: '2026-11' } };
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
    };

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.analytics).toMatchObject({
      studentAthletesByDepartment: [{ department: 'CICS', count: 4 }],
      borrowingsByDepartment: [{ department: 'CICS', count: 3 }],
      equipmentBorrowingFrequency: [{ equipment: 'Basketball', count: 5, transactions: 3 }],
      borrowerTypeActivity: [{ borrowerType: 'Student', count: 3, transactions: 3, borrowers: 2 }],
      studentAthleteRegistrationTrend: [{ period: '2026-11', count: 4 }],
      borrowingTrend: [{ period: '2026-11', count: 2 }],
      equipmentBorrowingTrend: [{ period: '2026-11', count: 5 }],
      totalBorrowingTransactions: 2,
      totalRegisteredStudentAthletes: 12,
      studentAthletesRegisteredInPeriod: 4,
      previousStudentAthletesRegistered: 4,
      previousBorrowingTransactions: 2,
      period: {
        type: 'monthly',
        selectedDate: '2026-11',
        startDate: '2026-11-01',
        endDate: '2026-11-30',
        previousStartDate: '2026-10-01',
        previousEndDate: '2026-10-31',
        timeZone: 'Asia/Manila',
      },
    });
    expect(StudentAthlete.aggregate).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ $match: { createdAt: expect.objectContaining({ $gte: expect.any(Date), $lt: expect.any(Date) }) } }),
    ]));
    expect(StudentAthlete.aggregate.mock.calls[0][0][0].$match.createdAt.$gte.toISOString())
      .toBe('2026-10-31T16:00:00.000Z');
    expect(Borrowing.aggregate).toHaveBeenCalledTimes(5);
    expect(Borrowing.aggregate.mock.calls[0][0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ $lookup: expect.objectContaining({ from: 'users' }) }),
      expect.objectContaining({ $lookup: expect.objectContaining({ from: 'studentathletes' }) }),
      expect.objectContaining({ $group: expect.any(Object) }),
    ]));
    expect(JSON.stringify(Borrowing.aggregate.mock.calls[0][0])).toContain('$regexFindAll');
    expect(Borrowing.aggregate.mock.calls[1][0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ $lookup: expect.objectContaining({ from: 'equipments' }) }),
      expect.objectContaining({ $unwind: '$equipmentItemsForAnalytics' }),
      expect.objectContaining({ $group: expect.any(Object) }),
    ]));
    expect(JSON.stringify(Borrowing.aggregate.mock.calls[1][0])).toContain('"transaction":"$_id"');
    expect(JSON.stringify(Borrowing.aggregate.mock.calls[1][0])).toContain('"uniqueReferenceIds"');
    expect(Borrowing.aggregate.mock.calls[1][0][0].$match.$and[0].status.$not).toBeInstanceOf(RegExp);
    expect(Borrowing.aggregate.mock.calls[1][0][0].$match.$and[0].status.$not.test('Cancelled')).toBe(true);
    expect(Borrowing.aggregate.mock.calls[2][0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ $group: expect.objectContaining({ _id: expect.objectContaining({ type: '$borrowerType' }) }) }),
    ]));
    expect(JSON.stringify(Borrowing.aggregate.mock.calls[2][0])).toContain('contactNo');
    expect(JSON.stringify(Borrowing.aggregate.mock.calls[2][0])).toContain('$regexFindAll');
    expect(JSON.stringify(Borrowing.aggregate.mock.calls)).not.toContain('$regexReplace');
    expect(JSON.stringify(Borrowing.aggregate.mock.calls[4][0])).toContain('Asia/Manila');
    expect(JSON.stringify(Borrowing.aggregate.mock.calls[1][0])).toContain('"referenceIds":1');
    expect(Borrowing.countDocuments).toHaveBeenCalledWith(expect.objectContaining({
      $and: expect.arrayContaining([expect.objectContaining({ status: expect.any(Object) })]),
    }));
  });

  it('rejects invalid reporting periods without querying analytics models', async () => {
    const routeLayer = router.stack.find((layer) => layer.route?.path === '/admin/dashboard');
    const handler = routeLayer.route.stack[routeLayer.route.stack.length - 1].handle;
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
    };

    await handler({ query: { period: 'quarterly', date: '2026-Q4' } }, res);

    expect(res.statusCode).toBe(400);
    expect(StudentAthlete.aggregate).not.toHaveBeenCalled();
    expect(Borrowing.aggregate).not.toHaveBeenCalled();
  });

  it('builds Manila calendar ranges for day, week, month, and year filters', async () => {
    User.countDocuments.mockResolvedValue(0);
    User.find.mockReturnValue({
      sort: () => ({
        limit: () => ({
          select: async () => [],
        }),
      }),
    });
    Equipment.countDocuments.mockResolvedValue(0);
    Borrowing.countDocuments.mockResolvedValue(0);
    ScheduleRequest.countDocuments.mockResolvedValue(0);
    StudentAthlete.aggregate.mockResolvedValue([]);
    StudentAthlete.countDocuments.mockResolvedValue(0);
    Borrowing.aggregate.mockResolvedValue([]);
    Schedule.find.mockReturnValue({
      sort: () => ({
        limit: () => ({
          lean: async () => [],
        }),
      }),
    });

    const handlers = router.stack.find((layer) => layer.route?.path === '/admin/dashboard').route.stack;
    const handler = handlers[handlers.length - 1].handle;
    const cases = [
      { period: 'daily', date: '2026-11-08', start: '2026-11-08', end: '2026-11-08' },
      { period: 'weekly', date: '2026-11-08', start: '2026-11-02', end: '2026-11-08' },
      { period: 'monthly', date: '2026-11', start: '2026-11-01', end: '2026-11-30' },
      { period: 'yearly', date: '2026', start: '2026-01-01', end: '2026-12-31' },
    ];

    for (const testCase of cases) {
      const res = {
        statusCode: 200,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(body) {
          this.body = body;
          return this;
        },
      };
      await handler({ query: testCase }, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.analytics.period).toMatchObject({
        type: testCase.period,
        startDate: testCase.start,
        endDate: testCase.end,
      });
    }

    expect(JSON.stringify(Borrowing.aggregate.mock.calls)).toContain('"timezone":"Asia/Manila"');
  });
});
