const { 
  getBorrowingRecords, 
  createBorrowing, 
  returnBorrowedItem, 
  deleteBorrowingRecord,
  updateBorrowingRecord 
} = require('../../src/controllers/borrowingController');
const Borrowing = require('../../src/models/Borrowing');
const Equipment = require('../../src/models/Equipment');
const httpMocks = require('node-mocks-http');

jest.mock('../../src/models/Borrowing');
jest.mock('../../src/models/Equipment');

describe('Borrowing Controller Unit Tests', () => {
  let req, res;

  beforeEach(() => {
    req = httpMocks.createRequest();
    res = httpMocks.createResponse();
    jest.clearAllMocks();
    Equipment.find.mockResolvedValue([]);
    Equipment.findOne.mockReset();
    Equipment.create.mockReset();
  });

  describe('GET /admin/borrowing (getBorrowingRecords)', () => {
    it('should return 200 OK and list of borrowing records', async () => {
      const fakeRecords = [
        { 
          _id: '1', 
          Name: 'Prof. Reyes', 
          equipment: 'Basketball', 
          quantity: 5, 
          status: 'Out Now',
          borrowDate: new Date(),
          borrowedBy: null,
          returnDate: null,
          returnedAt: null
        }
      ];
      
      const mockQuery = {
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockResolvedValue(fakeRecords)
      };
      
      Borrowing.find.mockReturnValue(mockQuery);
      await getBorrowingRecords(req, res);

      expect(res.statusCode).toBe(200);
      const responseData = res._getJSONData();
      expect(Array.isArray(responseData)).toBe(true);
      expect(responseData).toHaveLength(1);
      expect(responseData[0].Name).toBe('Prof. Reyes');
    });
  });

  describe('POST /admin/borrowing (createBorrowing)', () => {
    it('should return 201 Created and create borrowing record', async () => {
      req.body = { Name: 'Prof. Juan', equipment: 'Basketball', quantity: 2 };
      req.user = { id: 'admin123' };
      
      const fakeEquipment = { 
        _id: 'equip1', 
        name: 'Basketball', 
        available: 10,
        onLoan: 5,
        save: jest.fn().mockResolvedValue(true)
      };
      
      const fakeBorrowing = {
        _id: 'borrow1',
        Name: 'Prof. Juan',
        equipment: 'Basketball',
        quantity: 2,
        status: 'Out Now',
        borrowDate: new Date()
      };
      
      Equipment.findOne.mockResolvedValue(fakeEquipment);
      Borrowing.create.mockResolvedValue(fakeBorrowing);
      await createBorrowing(req, res);

      expect(res.statusCode).toBe(201);
      expect(Equipment.findOne).toHaveBeenCalled();
      expect(Borrowing.create).toHaveBeenCalled();
    });

    it('should ignore invalid borrowedBy values and still create a borrowing record', async () => {
      req.body = { Name: 'Prof. Juan', equipment: 'Basketball', quantity: 2 };
      req.user = { id: '267456"' };

      const fakeEquipment = {
        _id: 'equip1',
        name: 'Basketball',
        available: 10,
        onLoan: 5,
        save: jest.fn().mockResolvedValue(true)
      };

      const fakeBorrowing = {
        _id: 'borrow1',
        Name: 'Prof. Juan',
        equipment: 'Basketball',
        quantity: 2,
        status: 'Out Now',
        borrowDate: new Date()
      };

      Equipment.findOne.mockResolvedValue(fakeEquipment);
      Borrowing.create.mockResolvedValue(fakeBorrowing);
      await createBorrowing(req, res);

      expect(res.statusCode).toBe(201);
      expect(Borrowing.create).toHaveBeenCalledWith(expect.objectContaining({ borrowedBy: null }));
    });

    it('should return 400 if fields are missing', async () => {
      req.body = { Name: '', equipment: '', quantity: '' };
      await createBorrowing(req, res);

      expect(res.statusCode).toBe(400);
      expect(res._getJSONData().message).toBe('Please fill in all fields');
    });

    it('should return 400 if quantity is less than 1', async () => {
      req.body = { Name: 'Prof. Juan', equipment: 'Basketball', quantity: 0 };
      await createBorrowing(req, res);

      expect(res.statusCode).toBe(400);
      expect(res._getJSONData().message).toBe('Quantity must be at least 1');
    });

    it('should return 400 if insufficient stock', async () => {
      req.body = { Name: 'Prof. Juan', equipment: 'Basketball', quantity: 20 };
      const fakeEquipment = { _id: 'equip1', name: 'Basketball', available: 5 };
      
      Equipment.findOne.mockResolvedValue(fakeEquipment);
      await createBorrowing(req, res);

      expect(res.statusCode).toBe(400);
      expect(res._getJSONData().message).toContain('Insufficient stock');
    });

    it('should return 404 if equipment not found', async () => {
      req.body = { Name: 'Prof. Juan', equipment: 'Non-existent Equipment', quantity: 2 };
      Equipment.findOne.mockResolvedValue(null);
      await createBorrowing(req, res);

      expect(res.statusCode).toBe(404);
      expect(res._getJSONData().message).toContain('not found');
    });
  });

  describe('PUT /admin/borrowing/:id/return (returnBorrowedItem)', () => {
    it('should return 200 OK and mark item as returned', async () => {
      req.params = { id: 'borrow1' };
      
      const fakeBorrowing = {
        _id: 'borrow1',
        Name: 'Prof. Juan',
        equipment: 'Basketball',
        quantity: 2,
        status: 'Out Now',
        borrowDate: new Date(),
        save: jest.fn().mockResolvedValue(true)
      };
      
      const fakeEquipment = {
        _id: 'equip1',
        name: 'Basketball',
        onLoan: 7,
        save: jest.fn().mockResolvedValue(true)
      };
      
      Borrowing.findById.mockResolvedValue(fakeBorrowing);
      Equipment.findOne.mockResolvedValue(fakeEquipment);
      await returnBorrowedItem(req, res);

      expect(res.statusCode).toBe(200);
      expect(fakeBorrowing.status).toBe('Completed');
    });

    it('should return 404 if borrowing record not found', async () => {
      req.params = { id: 'nonexistent' };
      Borrowing.findById.mockResolvedValue(null);
      await returnBorrowedItem(req, res);

      expect(res.statusCode).toBe(404);
      expect(res._getJSONData().message).toBe('Borrowing record not found');
    });

    it('should return 400 if item already returned', async () => {
      req.params = { id: 'borrow1' };
      const fakeBorrowing = { _id: 'borrow1', status: 'Completed' };
      
      Borrowing.findById.mockResolvedValue(fakeBorrowing);
      await returnBorrowedItem(req, res);

      expect(res.statusCode).toBe(400);
      expect(res._getJSONData().message).toBe('Item already returned');
    });

    it('should keep the damaged reference ID and create a replacement item when a returned item is damaged', async () => {
      req.params = { id: 'borrow-damaged' };
      const fakeBorrowing = {
        _id: 'borrow-damaged',
        Name: 'Prof. Juan',
        equipment: 'Volleyball',
        quantity: 1,
        qty: 1,
        status: 'Out Now',
        referenceIds: ['VOL-01'],
        referenceConditions: ['Damaged'],
        borrowDate: new Date(),
        save: jest.fn().mockResolvedValue(true)
      };

      const damagedEquipment = {
        _id: 'equip-vol-01',
        name: 'Volleyball',
        referenceId: 'VOL-01',
        condition: 'Good',
        onLoan: 1,
        totalStock: 1,
        save: jest.fn().mockResolvedValue(true)
      };

      Borrowing.findById.mockResolvedValue(fakeBorrowing);
      Equipment.findOne
        .mockResolvedValueOnce(damagedEquipment) // name lookup before return
        .mockResolvedValueOnce(damagedEquipment) // reference lookup during sync
        .mockResolvedValueOnce(damagedEquipment) // original equipment lookup for replacement
        .mockResolvedValueOnce(null); // duplicate replacement check
      Equipment.create.mockResolvedValue({
        _id: 'equip-vol-04',
        name: 'Volleyball',
        referenceId: 'VOL-04',
        condition: 'Good',
        totalStock: 1,
        onLoan: 0,
        available: 1
      });

      await returnBorrowedItem(req, res);

      expect(damagedEquipment.condition).toBe('Damaged');
      expect(Equipment.create).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Volleyball',
        referenceId: expect.stringMatching(/^VOL-/),
        condition: 'Good'
      }));
      expect(res.statusCode).toBe(200);
    });
  });

  describe('DELETE /admin/borrowing/:id (deleteBorrowingRecord)', () => {
    it('should return 200 OK and delete record', async () => {
      req.params = { id: 'borrow1' };
      const fakeBorrowing = { 
        _id: 'borrow1', 
        status: 'Completed',
        equipment: 'Basketball',
        quantity: 2
      };
      
      Borrowing.findById.mockResolvedValue(fakeBorrowing);
      Borrowing.findByIdAndDelete.mockResolvedValue(true);
      await deleteBorrowingRecord(req, res);

      expect(res.statusCode).toBe(200);
      expect(res._getJSONData().message).toBe('Borrowing record deleted successfully');
    });

    it('should return 404 if borrowing record not found', async () => {
      req.params = { id: 'nonexistent' };
      Borrowing.findById.mockResolvedValue(null);
      await deleteBorrowingRecord(req, res);

      expect(res.statusCode).toBe(404);
      expect(res._getJSONData().message).toBe('Borrowing record not found');
    });

    it('should update equipment stock when deleting an active borrowing', async () => {
      req.params = { id: 'borrow1' };
      const fakeBorrowing = { 
        _id: 'borrow1', 
        status: 'Out Now',
        equipment: 'Basketball',
        quantity: 2
      };
      
      const fakeEquipment = {
        _id: 'equip1',
        name: 'Basketball',
        onLoan: 7,
        save: jest.fn().mockResolvedValue(true)
      };
      
      Borrowing.findById.mockResolvedValue(fakeBorrowing);
      Equipment.findOne.mockResolvedValue(fakeEquipment);
      Borrowing.findByIdAndDelete.mockResolvedValue(true);
      await deleteBorrowingRecord(req, res);

      expect(Equipment.findOne).toHaveBeenCalled();
      expect(fakeEquipment.save).toHaveBeenCalled();
      expect(res.statusCode).toBe(200);
    });
  });

  describe('PUT /admin/borrowing/:id (updateBorrowingRecord)', () => {
    it('should update matching equipment conditions by reference ID when conditions change', async () => {
      req.params = { id: 'borrow-123' };
      req.body = { referenceConditions: ['Damaged', 'Good'] };

      const fakeBorrowing = {
        _id: 'borrow-123',
        Name: 'Player One',
        fullname: 'Player One',
        equipment: 'Basketball',
        quantity: 2,
        qty: 2,
        referenceIds: ['BB-001', 'BB-002'],
        referenceConditions: ['Good', 'Good'],
        contactNo: '',
        facebookAccount: '',
        status: 'Out Now',
        borrowDate: new Date(),
        borrowTimestamp: { date: '2026-08-30', time: '09:00 AM' }
      };

      const firstEquipment = {
        _id: 'eq-1',
        name: 'Basketball',
        referenceId: 'BB-001',
        condition: 'Good',
        save: jest.fn().mockResolvedValue(true)
      };

      const secondEquipment = {
        _id: 'eq-2',
        name: 'Basketball',
        referenceId: 'BB-002',
        condition: 'Good',
        save: jest.fn().mockResolvedValue(true)
      };

      Borrowing.findById.mockResolvedValue(fakeBorrowing);
      Borrowing.findByIdAndUpdate.mockResolvedValue({
        ...fakeBorrowing,
        referenceConditions: ['Damaged', 'Good']
      });
      Equipment.findOne
        .mockResolvedValueOnce(firstEquipment)
        .mockResolvedValueOnce(secondEquipment);

      await updateBorrowingRecord(req, res);

      expect(Equipment.findOne).toHaveBeenNthCalledWith(1, { referenceId: 'BB-001' });
      expect(Equipment.findOne).toHaveBeenNthCalledWith(2, { referenceId: 'BB-002' });
      expect(firstEquipment.condition).toBe('Damaged');
      expect(secondEquipment.condition).toBe('Good');
      expect(firstEquipment.save).toHaveBeenCalled();
      expect(secondEquipment.save).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(200);
    });

    it('should update the exact equipment record when only a single returned item condition is present', async () => {
      req.params = { id: 'borrow-456' };
      req.body = { status: 'Returned', condition: 'Damaged' };

      const fakeBorrowing = {
        _id: 'borrow-456',
        Name: 'Player Two',
        fullname: 'Player Two',
        equipment: 'Basketball',
        quantity: 1,
        qty: 1,
        referenceIds: ['BASK-04-001'],
        referenceConditions: [],
        condition: 'Good',
        contactNo: '',
        facebookAccount: '',
        status: 'Out Now',
        borrowDate: new Date(),
        borrowTimestamp: { date: '2026-08-30', time: '09:00 AM' }
      };

      const equipmentItem = {
        _id: 'eq-3',
        name: 'Basketball',
        referenceId: 'BASK-04-001',
        condition: 'Good',
        save: jest.fn().mockResolvedValue(true)
      };

      Borrowing.findById.mockResolvedValue(fakeBorrowing);
      Borrowing.findByIdAndUpdate.mockResolvedValue({
        ...fakeBorrowing,
        status: 'Completed',
        condition: 'Damaged'
      });
      Equipment.findOne.mockResolvedValue(equipmentItem);

      await updateBorrowingRecord(req, res);

      expect(Equipment.findOne).toHaveBeenCalledWith({ referenceId: 'BASK-04-001' });
      expect(equipmentItem.condition).toBe('Damaged');
      expect(equipmentItem.save).toHaveBeenCalled();
      expect(res.statusCode).toBe(200);
    });

    it('should only update the exact reference ID when a single condition is attached to a multi-item borrowing', async () => {
      req.params = { id: 'borrow-789' };
      req.body = { status: 'Returned', condition: 'Damaged' };

      const fakeBorrowing = {
        _id: 'borrow-789',
        Name: 'Player Three',
        fullname: 'Player Three',
        equipment: 'Basketball',
        quantity: 2,
        qty: 2,
        referenceIds: ['BB-001', 'BB-002'],
        referenceConditions: ['Damaged'],
        condition: 'Good',
        contactNo: '',
        facebookAccount: '',
        status: 'Out Now',
        borrowDate: new Date(),
        borrowTimestamp: { date: '2026-08-30', time: '09:00 AM' }
      };

      const stockEquipment = {
        _id: 'eq-stock',
        name: 'Basketball',
        onLoan: 3,
        save: jest.fn().mockResolvedValue(true)
      };

      const firstEquipment = {
        _id: 'eq-4',
        name: 'Basketball',
        referenceId: 'BB-001',
        condition: 'Good',
        save: jest.fn().mockResolvedValue(true)
      };

      Borrowing.findById.mockResolvedValue(fakeBorrowing);
      Borrowing.findByIdAndUpdate.mockResolvedValue({
        ...fakeBorrowing,
        status: 'Completed',
        condition: 'Damaged',
        referenceConditions: ['Damaged'],
        referenceIds: ['BB-001', 'BB-002']
      });
      Equipment.findOne
        .mockResolvedValueOnce(stockEquipment)
        .mockResolvedValueOnce(firstEquipment);

      await updateBorrowingRecord(req, res);

      expect(Equipment.findOne).toHaveBeenNthCalledWith(1, { name: 'Basketball' });
      expect(Equipment.findOne).toHaveBeenNthCalledWith(2, { referenceId: 'BB-001' });
      expect(firstEquipment.condition).toBe('Damaged');
      expect(firstEquipment.save).toHaveBeenCalled();
      expect(res.statusCode).toBe(200);
    });
  });
});