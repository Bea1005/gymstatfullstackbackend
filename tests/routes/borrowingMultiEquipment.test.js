const httpMocks = require('node-mocks-http');
const mongoose = require('mongoose');
const Borrowing = require('../../src/models/Borrowing');
const Equipment = require('../../src/models/Equipment');
const borrowingRoutes = require('../../src/routes/borrowingRoutes');

jest.mock('../../src/models/Borrowing', () => ({
  find: jest.fn(), create: jest.fn(), findById: jest.fn(),
}));
jest.mock('../../src/models/Equipment', () => ({
  find: jest.fn(), findOne: jest.fn(),
}));

const getHandler = (method, routePath) => {
  const layer = borrowingRoutes.stack.find((entry) => (
    entry.route && entry.route.path === routePath && entry.route.methods[method]
  ));
  if (!layer) throw new Error('Route handler not found: ' + method + ' ' + routePath);
  return layer.route.stack[layer.route.stack.length - 1].handle;
};

const createEquipment = (name, referenceId, available = 1) => ({
  name, referenceId, totalStock: 1, available, onLoan: available ? 0 : 1, condition: 'Good',
  save: jest.fn().mockImplementation(async function save() {
    this.available = this.totalStock - this.onLoan;
  }),
});
const createSession = () => ({
  withTransaction: jest.fn(async (callback) => callback()), endSession: jest.fn(),
});
const createEquipmentFindQuery = (items) => {
  const query = { session: jest.fn().mockResolvedValue(items) };
  query.then = (resolve, reject) => Promise.resolve(items).then(resolve, reject);
  return query;
};

let session;
beforeEach(() => {
  jest.clearAllMocks();
  session = createSession();
  jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
});
afterEach(() => jest.restoreAllMocks());

describe('multi-equipment borrowing transaction routes', () => {
  test('creates one transaction with distinct equipment groups and updates each selected unit', async () => {
    const volleyball = createEquipment('Volleyball', 'VB-001');
    const volleyballSecond = createEquipment('Volleyball', 'VB-002');
    const baseball = createEquipment('Baseball', 'BB-001');
    const equipmentById = new Map([
      [volleyball.referenceId, volleyball],
      [volleyballSecond.referenceId, volleyballSecond],
      [baseball.referenceId, baseball],
    ]);
    Equipment.findOne.mockResolvedValue({ name: 'equipment' });
    Equipment.find.mockImplementation((filter) => createEquipmentFindQuery(
      filter.referenceId.$in.map((id) => equipmentById.get(id)).filter(Boolean)
    ));
    Borrowing.create.mockImplementation(async ([record]) => [{
      ...record, _id: 'borrow-1', borrowDate: new Date(), populate: jest.fn(),
    }]);
    const req = httpMocks.createRequest({
      method: 'POST', user: { id: 'admin-id' },
      body: {
        fullname: 'Student Athlete',
        equipmentItems: [
          { equipment: 'Volleyball', referenceIds: ['VB-001', 'VB-002'], referenceConditions: ['Good', 'Good'], quantity: 2 },
          { equipment: 'Baseball', referenceIds: ['BB-001'], referenceConditions: ['Good'], quantity: 1 },
        ], quantity: 3, referenceIds: ['VB-001', 'VB-002', 'BB-001'],
      },
    });
    const res = httpMocks.createResponse();
    await getHandler('post', '/admin/borrowing')(req, res);
    expect(res.statusCode).toBe(201);
    expect(volleyball.onLoan).toBe(1);
    expect(volleyballSecond.onLoan).toBe(1);
    expect(baseball.onLoan).toBe(1);
    expect(Borrowing.create.mock.calls[0][0][0]).toMatchObject({
      equipment: 'Volleyball, Baseball',
      equipmentItems: [
        { equipment: 'Volleyball', referenceIds: ['VB-001', 'VB-002'], quantity: 2 },
        { equipment: 'Baseball', referenceIds: ['BB-001'], quantity: 1 },
      ], referenceIds: ['VB-001', 'VB-002', 'BB-001'], quantity: 3,
    });
    expect(session.withTransaction).toHaveBeenCalledTimes(1);
  });

  test('keeps accepting a legacy single-equipment request', async () => {
    const ball = createEquipment('Volleyball', 'VB-002');
    Equipment.findOne.mockResolvedValue({ name: 'Volleyball' });
    Equipment.find.mockImplementation(() => createEquipmentFindQuery([ball]));
    Borrowing.create.mockImplementation(async ([record]) => [{ ...record, _id: 'legacy', populate: jest.fn() }]);
    const req = httpMocks.createRequest({
      method: 'POST', body: { fullname: 'Student Athlete', equipment: 'Volleyball', quantity: 1, referenceIds: ['VB-002'] },
    });
    const res = httpMocks.createResponse();
    await getHandler('post', '/admin/borrowing')(req, res);
    expect(res.statusCode).toBe(201);
    expect(Borrowing.create.mock.calls[0][0][0].equipmentItems).toEqual([
      expect.objectContaining({ equipment: 'Volleyball', referenceIds: ['VB-002'], quantity: 1 }),
    ]);
  });

  test('rejects duplicate Reference IDs across equipment groups', async () => {
    const req = httpMocks.createRequest({
      method: 'POST', body: {
        fullname: 'Student Athlete',
        equipmentItems: [
          { equipment: 'Volleyball', referenceIds: ['DUP-01'], quantity: 1 },
          { equipment: 'Baseball', referenceIds: ['DUP-01'], quantity: 1 },
        ],
      },
    });
    const res = httpMocks.createResponse();
    await getHandler('post', '/admin/borrowing')(req, res);
    expect(res.statusCode).toBe(400);
    expect(res._getJSONData().error).toMatch(/unique/i);
    expect(Borrowing.create).not.toHaveBeenCalled();
    expect(Equipment.find).not.toHaveBeenCalled();
  });

  test('rejects Reference IDs that belong to a different equipment type', async () => {
    const wrongUnit = createEquipment('Volleyball', 'VB-005');
    Equipment.findOne.mockResolvedValue({ name: 'equipment' });
    Equipment.find.mockImplementation((filter) => createEquipmentFindQuery(
      [wrongUnit].filter((item) => (
        new RegExp(filter.name.$regex, filter.name.$options).test(item.name)
      ))
    ));
    const req = httpMocks.createRequest({
      method: 'POST', body: {
        fullname: 'Student Athlete',
        equipmentItems: [{ equipment: 'Baseball', referenceIds: ['VB-005'], quantity: 1 }],
      },
    });
    const res = httpMocks.createResponse();
    await getHandler('post', '/admin/borrowing')(req, res);
    expect(res.statusCode).toBe(400);
    expect(res._getJSONData().error).toMatch(/do not belong/i);
    expect(wrongUnit.save).not.toHaveBeenCalled();
    expect(Borrowing.create).not.toHaveBeenCalled();
  });

  test('rejects unavailable Reference IDs without updating any selected equipment', async () => {
    const available = createEquipment('Volleyball', 'VB-003');
    const unavailable = createEquipment('Baseball', 'BB-003', 0);
    Equipment.findOne.mockResolvedValue({ name: 'equipment' });
    Equipment.find.mockImplementation((filter) => createEquipmentFindQuery(
      filter.referenceId.$in[0] === 'VB-003' ? [available] : [unavailable]
    ));
    const req = httpMocks.createRequest({
      method: 'POST', body: {
        fullname: 'Student Athlete',
        equipmentItems: [
          { equipment: 'Volleyball', referenceIds: ['VB-003'], quantity: 1 },
          { equipment: 'Baseball', referenceIds: ['BB-003'], quantity: 1 },
        ],
      },
    });
    const res = httpMocks.createResponse();
    await getHandler('post', '/admin/borrowing')(req, res);
    expect(res.statusCode).toBe(400);
    expect(res._getJSONData().error).toMatch(/no longer available/i);
    expect(available.save).not.toHaveBeenCalled();
    expect(unavailable.save).not.toHaveBeenCalled();
    expect(Borrowing.create).not.toHaveBeenCalled();
  });

  test('restores stock for each equipment group when the transaction is returned', async () => {
    const volleyball = createEquipment('Volleyball', 'VB-004', 0);
    const baseball = createEquipment('Baseball', 'BB-004', 0);
    const equipmentById = new Map([[volleyball.referenceId, volleyball], [baseball.referenceId, baseball]]);
    const borrowing = {
      _id: 'borrow-return', equipment: 'Volleyball, Baseball',
      equipmentItems: [
        { equipment: 'Volleyball', referenceIds: ['VB-004'], referenceConditions: ['Good'], quantity: 1 },
        { equipment: 'Baseball', referenceIds: ['BB-004'], referenceConditions: ['Good'], quantity: 1 },
      ], referenceIds: ['VB-004', 'BB-004'], referenceConditions: ['Good', 'Good'],
      quantity: 2, status: 'Out Now', save: jest.fn().mockResolvedValue(true), populate: jest.fn(),
    };
    Borrowing.findById.mockResolvedValue(borrowing);
    Equipment.findOne.mockImplementation(async ({ referenceId }) => equipmentById.get(referenceId));
    Equipment.find.mockImplementation((filter) => createEquipmentFindQuery(
      filter.referenceId.$in.map((id) => equipmentById.get(id)).filter(Boolean)
    ));
    const req = httpMocks.createRequest({ method: 'PUT', params: { id: 'borrow-return' }, body: {} });
    const res = httpMocks.createResponse();
    await getHandler('put', '/admin/borrowing/:id/return')(req, res);
    expect(res.statusCode).toBe(200);
    expect(borrowing.status).toBe('Completed');
    expect(volleyball.onLoan).toBe(0);
    expect(baseball.onLoan).toBe(0);
  });
});
