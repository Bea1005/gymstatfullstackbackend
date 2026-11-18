const httpMocks = require('node-mocks-http');

jest.mock('../../src/models/SecurityLog', () => ({
  find: jest.fn(),
  countDocuments: jest.fn()
}));

const SecurityLog = require('../../src/models/SecurityLog');
const { getAuditLogs, exportAuditLogs } = require('../../src/controllers/auditLogController');

const createFindQuery = (records) => {
  const query = {
    select: jest.fn(),
    sort: jest.fn(),
    skip: jest.fn(),
    limit: jest.fn(),
    lean: jest.fn().mockResolvedValue(records)
  };
  query.select.mockReturnValue(query);
  query.sort.mockReturnValue(query);
  query.skip.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  return query;
};

describe('audit log controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('combines search, role, action, module, status, date, and pagination filters', async () => {
    const records = [{ _id: 'audit-1', action: 'UPDATE', role: 'admin' }];
    const query = createFindQuery(records);
    SecurityLog.find.mockReturnValue(query);
    SecurityLog.countDocuments.mockResolvedValue(41);
    const req = httpMocks.createRequest({
      method: 'GET',
      query: {
        search: 'student[1]',
        role: 'ADMIN',
        action: 'update',
        module: 'User Management',
        result: 'success',
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-02-01T00:00:00.000Z',
        page: '2',
        pageSize: '20'
      }
    });
    const res = httpMocks.createResponse();

    await getAuditLogs(req, res);

    const filter = SecurityLog.find.mock.calls[0][0];
    expect(filter).toEqual(expect.objectContaining({
      role: 'admin',
      action: 'UPDATE',
      module: 'User Management',
      result: 'SUCCESS',
      timestamp: {
        $gte: new Date('2026-01-01T00:00:00.000Z'),
        $lt: new Date('2026-02-01T00:00:00.000Z')
      },
      $or: expect.arrayContaining([
        { actorName: /student\[1\]/i },
        { description: /student\[1\]/i }
      ])
    }));
    expect(query.skip).toHaveBeenCalledWith(20);
    expect(query.limit).toHaveBeenCalledWith(20);
    expect(query.select).toHaveBeenCalledWith(expect.stringContaining('actorName'));
    expect(SecurityLog.countDocuments).toHaveBeenCalledWith(filter);
    expect(res._getJSONData()).toEqual({
      success: true,
      records,
      pagination: { page: 2, pageSize: 20, total: 41, totalPages: 3 }
    });
  });

  it('rejects invalid date ranges', async () => {
    const res = httpMocks.createResponse();
    await getAuditLogs(
      httpMocks.createRequest({ method: 'GET', query: { startDate: 'not-a-date' } }),
      res
    );

    expect(res.statusCode).toBe(400);
    expect(SecurityLog.find).not.toHaveBeenCalled();
  });

  it('exports matching records as formula-safe CSV', async () => {
    SecurityLog.countDocuments.mockResolvedValue(1);
    SecurityLog.find.mockReturnValue(createFindQuery([{
      timestamp: new Date('2026-01-02T03:04:05.000Z'),
      actorName: '=IMPORT("unsafe")',
      userId: 'user-1',
      role: 'admin',
      action: 'UPDATE',
      module: 'User Management',
      description: 'Updated a user.',
      affectedRecord: 'user-2',
      result: 'SUCCESS',
      httpStatus: 200,
      changedFields: ['role']
    }]));
    const res = httpMocks.createResponse();

    await exportAuditLogs(httpMocks.createRequest({ method: 'GET', query: { role: 'admin' } }), res);

    expect(res.statusCode).toBe(200);
    expect(res.getHeader('Content-Type')).toContain('text/csv');
    expect(res._getData()).toContain(`"'=IMPORT(""unsafe"")"`);
    expect(res._getData()).toContain('"role"');
  });
});
