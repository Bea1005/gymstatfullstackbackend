const { 
  getEquipment, 
  getEquipmentById,
  createEquipment, 
  updateEquipment, 
  deleteEquipment,
  borrowEquipment,
  returnEquipment,
  getEquipmentOptions,
  getEquipmentStats,
  getLowStockEquipment,
  getOutOfStockEquipment,
  getEquipmentCategories
} = require('../../src/controllers/equipmentController');
const Equipment = require('../../src/models/Equipment');
const httpMocks = require('node-mocks-http');

jest.mock('../../src/models/Equipment');

describe('Equipment Controller Unit Tests', () => {
  let req, res;
  let consoleErrorSpy;

  beforeEach(() => {
    req = httpMocks.createRequest();
    res = httpMocks.createResponse();
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('GET /admin/equipment (getEquipment)', () => {
    it('should return 200 OK and a list of equipment', async () => {
      const fakeEquipment = [
        { _id: '1', name: 'Basketball', referenceId: 'BB-001', category: 'Balls', totalStock: 50, available: 43, onLoan: 7, condition: 'Good' },
        { _id: '2', name: 'Volleyball Net', referenceId: 'VN-001', category: 'Net', totalStock: 5, available: 3, onLoan: 2, condition: 'Good' }
      ];
      
      Equipment.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue(fakeEquipment)
      });

      await getEquipment(req, res);

      expect(res.statusCode).toBe(200);
      expect(res._getJSONData().success).toBe(true);
      expect(res._getJSONData().data).toHaveLength(2);
      expect(res._getJSONData().data[0].referenceId).toBe('BB-001');
      expect(Equipment.find).toHaveBeenCalled();
    });

    it('should filter equipment by search query', async () => {
      req.query = { search: 'Basketball' };
      const fakeEquipment = [
        { _id: '1', name: 'Basketball', referenceId: 'BB-001', category: 'Balls', totalStock: 50, available: 43 }
      ];
      
      Equipment.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue(fakeEquipment)
      });

      await getEquipment(req, res);

      expect(res.statusCode).toBe(200);
      expect(Equipment.find).toHaveBeenCalledWith({
        $or: [
          { name: { $regex: 'Basketball', $options: 'i' } },
          { referenceId: { $regex: 'Basketball', $options: 'i' } }
        ]
      });
    });

    it('should return 500 if database error occurs', async () => {
      Equipment.find.mockReturnValue({
        sort: jest.fn().mockRejectedValue(new Error('Database connection failed'))
      });

      await getEquipment(req, res);

      expect(res.statusCode).toBe(500);
      expect(res._getJSONData().message).toContain('Server error');
    });
  });

  describe('GET /admin/equipment/:id (getEquipmentById)', () => {
    it('should return 200 OK and the equipment', async () => {
      req.params = { id: '12345' };
      const fakeEquipment = { 
        _id: '12345', 
        name: 'Basketball', 
        referenceId: 'BB-001',
        category: 'Balls', 
        totalStock: 50, 
        available: 43,
        onLoan: 7,
        condition: 'Good'
      };
      
      Equipment.findById.mockResolvedValue(fakeEquipment);

      await getEquipmentById(req, res);

      expect(res.statusCode).toBe(200);
      expect(res._getJSONData().success).toBe(true);
      expect(res._getJSONData().data.name).toBe('Basketball');
    });

    it('should return 404 if equipment not found', async () => {
      req.params = { id: 'nonexistent' };
      Equipment.findById.mockResolvedValue(null);

      await getEquipmentById(req, res);

      expect(res.statusCode).toBe(404);
      expect(res._getJSONData().message).toBe('Equipment not found');
    });
  });

  describe('POST /admin/equipment (createEquipment)', () => {
    it('should create new equipment when it does not exist', async () => {
      req.body = { name: 'Tennis Racket', referenceId: 'TR-001', condition: 'Good' };
      const fakeSavedEquipment = { 
        _id: '12345', 
        name: 'Tennis Racket', 
        referenceId: 'TR-001',
        category: 'Sports Equipment', 
        totalStock: 1,
        available: 1,
        onLoan: 0,
        condition: 'Good'
      };
      
      Equipment.findOne.mockResolvedValue(null);
      Equipment.create.mockResolvedValue(fakeSavedEquipment);

      await createEquipment(req, res);

      expect(res.statusCode).toBe(201);
      expect(res._getJSONData().success).toBe(true);
      expect(res._getJSONData().message).toContain('New Equipment Registered');
      expect(Equipment.create).toHaveBeenCalled();
    });

    it('should preserve the selected equipment type when the request provides a category', async () => {
      req.body = { name: 'Volleyball', referenceId: 'VB-001', category: 'Balls', condition: 'Good' };
      const fakeSavedEquipment = {
        _id: '12345',
        name: 'Volleyball',
        referenceId: 'VB-001',
        type: 'Balls',
        category: 'Balls',
        totalStock: 1,
        available: 1,
        onLoan: 0,
        condition: 'Good'
      };

      Equipment.findOne.mockResolvedValue(null);
      Equipment.create.mockResolvedValue(fakeSavedEquipment);

      await createEquipment(req, res);

      expect(res.statusCode).toBe(201);
      expect(Equipment.create).toHaveBeenCalledWith(expect.objectContaining({
        type: 'Balls',
        category: 'Balls'
      }));
    });

    it('should update existing equipment when it already exists', async () => {
      req.body = { name: 'Basketball', referenceId: 'BB-002', condition: 'Good' };
      const existingEquipment = {
        _id: '12345',
        name: 'Basketball',
        referenceId: 'BB-001',
        totalStock: 10,
        available: 8,
        onLoan: 2,
        save: jest.fn().mockResolvedValue(true)
      };
      
      Equipment.findOne.mockResolvedValue(existingEquipment);

      await createEquipment(req, res);

      expect(res.statusCode).toBe(200);
      expect(res._getJSONData().success).toBe(true);
      expect(res._getJSONData().message).toContain('Updated Basketball');
      expect(existingEquipment.totalStock).toBe(11);
      expect(existingEquipment.save).toHaveBeenCalled();
    });

    it('should return 400 if name is missing', async () => {
      req.body = { referenceId: 'TR-001' };

      await createEquipment(req, res);

      expect(res.statusCode).toBe(400);
      expect(res._getJSONData().message).toBe('Equipment name is required');
    });

    it('should return 400 if reference ID is missing', async () => {
      req.body = { name: 'Tennis Racket' };

      await createEquipment(req, res);

      expect(res.statusCode).toBe(400);
      expect(res._getJSONData().message).toBe('Reference ID is required');
    });

    it('should return 400 if reference ID already exists', async () => {
      req.body = { name: 'New Racket', referenceId: 'EXISTING-001' };
      Equipment.findOne.mockResolvedValueOnce(null); // First call for name check
      Equipment.findOne.mockResolvedValueOnce({ _id: 'existing', referenceId: 'EXISTING-001' }); // Second call for refId check

      await createEquipment(req, res);

      expect(res.statusCode).toBe(400);
      expect(res._getJSONData().message).toBe('Reference ID already exists. Please use a unique ID.');
    });
  });

  describe('PUT /admin/equipment/:id (updateEquipment)', () => {
    it('should return 200 OK and updated equipment', async () => {
      req.params = { id: '12345' };
      req.body = { name: 'Updated Name', totalStock: 30 };
      
      const existingEquipment = {
        _id: '12345',
        name: 'Old Name',
        referenceId: 'OLD-001',
        totalStock: 20,
        save: jest.fn().mockResolvedValue(true)
      };
      
      Equipment.findById.mockResolvedValue(existingEquipment);
      Equipment.findOne.mockResolvedValue(null);

      await updateEquipment(req, res);

      expect(res.statusCode).toBe(200);
      expect(res._getJSONData().success).toBe(true);
      expect(existingEquipment.name).toBe('Updated Name');
      expect(existingEquipment.totalStock).toBe(30);
    });

    it('should return 400 if on-loan quantity exceeds total stock', async () => {
      req.params = { id: '12345' };
      req.body = { totalStock: 5, onLoan: 6 };

      const existingEquipment = {
        _id: '12345',
        name: 'Old Name',
        referenceId: 'OLD-001',
        totalStock: 5,
        onLoan: 0,
        save: jest.fn().mockResolvedValue(true)
      };

      Equipment.findById.mockResolvedValue(existingEquipment);

      await updateEquipment(req, res);

      expect(res.statusCode).toBe(400);
      expect(res._getJSONData().message).toContain('On-loan quantity cannot exceed total stock');
    });

    it('should return 404 if equipment not found', async () => {
      req.params = { id: 'nonexistent' };
      Equipment.findById.mockResolvedValue(null);

      await updateEquipment(req, res);

      expect(res.statusCode).toBe(404);
      expect(res._getJSONData().message).toBe('Equipment not found');
    });
  });

  describe('DELETE /admin/equipment/:id (deleteEquipment)', () => {
    it('should return 200 OK and success message', async () => {
      req.params = { id: '12345' };
      const existingEquipment = { _id: '12345', onLoan: 0 };
      
      Equipment.findById.mockResolvedValue(existingEquipment);
      Equipment.findByIdAndDelete.mockResolvedValue(true);

      await deleteEquipment(req, res);

      expect(res.statusCode).toBe(200);
      expect(res._getJSONData().message).toBe('Equipment deleted successfully');
    });

    it('should return 400 if equipment has items on loan', async () => {
      req.params = { id: '12345' };
      const existingEquipment = { _id: '12345', onLoan: 5 };
      
      Equipment.findById.mockResolvedValue(existingEquipment);

      await deleteEquipment(req, res);

      expect(res.statusCode).toBe(400);
      expect(res._getJSONData().message).toContain('Cannot delete equipment');
    });

    it('should return 404 if equipment not found', async () => {
      req.params = { id: 'nonexistent' };
      Equipment.findById.mockResolvedValue(null);

      await deleteEquipment(req, res);

      expect(res.statusCode).toBe(404);
      expect(res._getJSONData().message).toBe('Equipment not found');
    });
  });

  describe('PUT /admin/equipment/:id/borrow (borrowEquipment)', () => {
    it('should decrease available quantity when borrowing', async () => {
      req.params = { id: '12345' };
      req.body = { quantity: 2 };
      
      const existingEquipment = {
        _id: '12345',
        name: 'Basketball',
        totalStock: 10,
        available: 8,
        onLoan: 2,
        save: jest.fn().mockResolvedValue(true)
      };
      
      Equipment.findById.mockResolvedValue(existingEquipment);

      await borrowEquipment(req, res);

      expect(res.statusCode).toBe(200);
      expect(res._getJSONData().success).toBe(true);
      expect(res._getJSONData().message).toContain('Borrowed 2 Basketball');
      expect(existingEquipment.onLoan).toBe(4);
      expect(existingEquipment.save).toHaveBeenCalled();
    });

    it('should return 400 if quantity is invalid', async () => {
      req.params = { id: '12345' };
      req.body = { quantity: 0 };
      
      await borrowEquipment(req, res);

      expect(res.statusCode).toBe(400);
      expect(res._getJSONData().message).toBe('Quantity must be greater than 0');
    });

    it('should return 400 if insufficient stock', async () => {
      req.params = { id: '12345' };
      req.body = { quantity: 10 };
      
      const existingEquipment = {
        _id: '12345',
        name: 'Basketball',
        totalStock: 5,
        available: 3,
        onLoan: 2,
        save: jest.fn()
      };
      
      Equipment.findById.mockResolvedValue(existingEquipment);

      await borrowEquipment(req, res);

      expect(res.statusCode).toBe(400);
      expect(res._getJSONData().message).toContain('Insufficient stock');
    });

    it('should return 404 if equipment not found', async () => {
      req.params = { id: 'nonexistent' };
      req.body = { quantity: 1 };
      Equipment.findById.mockResolvedValue(null);

      await borrowEquipment(req, res);

      expect(res.statusCode).toBe(404);
      expect(res._getJSONData().message).toBe('Equipment not found');
    });
  });

  describe('PUT /admin/equipment/:id/return (returnEquipment)', () => {
    it('should increase available quantity when returning', async () => {
      req.params = { id: '12345' };
      req.body = { quantity: 2 };
      
      const existingEquipment = {
        _id: '12345',
        name: 'Basketball',
        totalStock: 10,
        available: 6,
        onLoan: 4,
        save: jest.fn().mockResolvedValue(true)
      };
      
      Equipment.findById.mockResolvedValue(existingEquipment);

      await returnEquipment(req, res);

      expect(res.statusCode).toBe(200);
      expect(res._getJSONData().success).toBe(true);
      expect(res._getJSONData().message).toContain('Returned 2 Basketball');
      expect(existingEquipment.onLoan).toBe(2);
      expect(existingEquipment.save).toHaveBeenCalled();
    });

    it('should return 400 if quantity is invalid', async () => {
      req.params = { id: '12345' };
      req.body = { quantity: -1 };
      
      await returnEquipment(req, res);

      expect(res.statusCode).toBe(400);
      expect(res._getJSONData().message).toBe('Quantity must be greater than 0');
    });

    it('should return 400 if returning more than on loan', async () => {
      req.params = { id: '12345' };
      req.body = { quantity: 10 };
      
      const existingEquipment = {
        _id: '12345',
        name: 'Basketball',
        totalStock: 5,
        available: 3,
        onLoan: 2,
        save: jest.fn()
      };
      
      Equipment.findById.mockResolvedValue(existingEquipment);

      await returnEquipment(req, res);

      expect(res.statusCode).toBe(400);
      expect(res._getJSONData().message).toContain('Cannot return more than borrowed');
    });
  });

  describe('GET /admin/equipment/options (getEquipmentOptions)', () => {
    it('should return list of sports equipment options', async () => {
      await getEquipmentOptions(req, res);

      expect(res.statusCode).toBe(200);
      expect(res._getJSONData().success).toBe(true);
      expect(res._getJSONData().options).toBeInstanceOf(Array);
      expect(res._getJSONData().options.length).toBeGreaterThan(0);
      expect(res._getJSONData().options).toContain('Basketball');
      expect(res._getJSONData().options).toContain('Volleyball');
    });
  });

  describe('GET /admin/equipment/stats (getEquipmentStats)', () => {
    it('should return equipment statistics', async () => {
      Equipment.countDocuments.mockResolvedValue(5);
      Equipment.aggregate
        .mockResolvedValueOnce([{ total: 150 }])  // totalItems
        .mockResolvedValueOnce([{ total: 120 }])  // totalAvailable
        .mockResolvedValueOnce([{ total: 30 }]);  // totalOnLoan

      await getEquipmentStats(req, res);

      expect(res.statusCode).toBe(200);
      expect(res._getJSONData().success).toBe(true);
      expect(res._getJSONData().stats.totalEquipmentTypes).toBe(5);
      expect(res._getJSONData().stats.totalItems).toBe(150);
      expect(res._getJSONData().stats.totalAvailable).toBe(120);
      expect(res._getJSONData().stats.totalOnLoan).toBe(30);
    });

    it('should handle empty database', async () => {
      Equipment.countDocuments.mockResolvedValue(0);
      Equipment.aggregate
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await getEquipmentStats(req, res);

      expect(res.statusCode).toBe(200);
      expect(res._getJSONData().stats.totalEquipmentTypes).toBe(0);
      expect(res._getJSONData().stats.totalItems).toBe(0);
      expect(res._getJSONData().stats.totalAvailable).toBe(0);
      expect(res._getJSONData().stats.totalOnLoan).toBe(0);
    });
  });

  describe('GET /admin/equipment/low-stock (getLowStockEquipment)', () => {
    it('should return low stock equipment', async () => {
      const lowStockItems = [
        { _id: '1', name: 'Basketball', available: 3, totalStock: 10 },
        { _id: '2', name: 'Volleyball', available: 1, totalStock: 5 }
      ];
      
      Equipment.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue(lowStockItems)
      });

      await getLowStockEquipment(req, res);

      expect(res.statusCode).toBe(200);
      expect(res._getJSONData().success).toBe(true);
      expect(res._getJSONData().data).toHaveLength(2);
      expect(Equipment.find).toHaveBeenCalledWith({ 
        available: { $lt: 5, $gt: 0 } 
      });
    });
  });

  describe('GET /admin/equipment/out-of-stock (getOutOfStockEquipment)', () => {
    it('should return out of stock equipment', async () => {
      const outOfStockItems = [
        { _id: '1', name: 'Tennis Racket', available: 0, totalStock: 5 },
        { _id: '2', name: 'Baseball Bat', available: 0, totalStock: 3 }
      ];
      
      Equipment.find.mockReturnValue({
        sort: jest.fn().mockResolvedValue(outOfStockItems)
      });

      await getOutOfStockEquipment(req, res);

      expect(res.statusCode).toBe(200);
      expect(res._getJSONData().success).toBe(true);
      expect(res._getJSONData().data).toHaveLength(2);
      expect(Equipment.find).toHaveBeenCalledWith({ status: 'Out of Stock' });
    });
  });

  describe('GET /admin/equipment/categories (getEquipmentCategories)', () => {
    it('should return distinct categories and conditions', async () => {
      Equipment.distinct
        .mockResolvedValueOnce(['Balls', 'Rackets', 'Net', 'General'])
        .mockResolvedValueOnce(['Good', 'Fair', 'Poor'])
        .mockResolvedValueOnce(['Available', 'Low Stock', 'Out of Stock']);

      await getEquipmentCategories(req, res);

      expect(res.statusCode).toBe(200);
      expect(res._getJSONData().success).toBe(true);
      expect(res._getJSONData().categories).toEqual(['Balls', 'Rackets', 'Net', 'General']);
      expect(res._getJSONData().conditions).toEqual(['Good', 'Fair', 'Poor']);
      expect(res._getJSONData().statuses).toEqual(['Available', 'Low Stock', 'Out of Stock']);
    });
  });
});