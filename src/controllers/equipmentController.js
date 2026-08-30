const Equipment = require('../models/Equipment');

// Predefined sports equipment options
const SPORTS_EQUIPMENT_OPTIONS = [
  'Basketball', 'Volleyball', 'Soccer Ball', 'Baseball Bat', 'Tennis Racket',
  'Badminton Racket', 'Table Tennis Paddle', 'Football', 'Gym Mat', 'Dumbbells',
  'Weight Plates', 'Jump Rope', 'Cones', 'Whistle', 'Stopwatch', 'First Aid Kit',
  'Water Jug', 'Scoreboard', 'Spalding Ball', 'Volleyball Mikasa', 'Racket'
];

const VALID_CONDITIONS = ['Good', 'Damaged', 'Lost', 'Under Repair', 'Fair', 'Poor'];
const VALID_CATEGORIES = ['Balls', 'Rackets', 'Net', 'General', 'Sports Equipment'];
const VALID_STATUSES = ['Available', 'Low Stock', 'Out of Stock'];

const sortByPreference = (values, preferredOrder) => {
  const normalized = [...new Set(values.filter(Boolean))];
  return normalized.sort((a, b) => {
    const indexA = preferredOrder.indexOf(a);
    const indexB = preferredOrder.indexOf(b);

    if (indexA === -1 && indexB === -1) {
      return a.localeCompare(b);
    }
    if (indexA === -1) {
      return 1;
    }
    if (indexB === -1) {
      return -1;
    }
    return indexA - indexB;
  });
};

const buildEquipmentPayload = (item) => ({
  id: item._id,
  name: item.name,
  type: item.type,
  referenceId: item.referenceId,
  category: item.category,
  total: item.totalStock,
  available: item.available,
  onLoan: item.onLoan,
  condition: item.condition,
  status: item.status,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt
});

const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '');

const parseNonNegativeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

// @desc    Get all equipment
// @route   GET /api/v1/admin/equipment
const getEquipment = async (req, res) => {
  try {
    const { search } = req.query;
    let query = {};

    if (search && search.trim()) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { referenceId: { $regex: search, $options: 'i' } }
      ];
    }

    const equipment = await Equipment.find(query).sort({ name: 1 });

    const totalItems = equipment.reduce((sum, item) => sum + (item.totalStock || 0), 0);
    const totalAvailable = equipment.reduce((sum, item) => sum + (item.available || 0), 0);
    const totalOnLoan = equipment.reduce((sum, item) => sum + (item.onLoan || 0), 0);

    res.status(200).json({
      success: true,
      data: equipment.map(buildEquipmentPayload),
      summary: {
        totalEquipmentTypes: equipment.length,
        totalItems,
        totalAvailable,
        totalOnLoan
      }
    });
  } catch (error) {
    console.error('Get equipment error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// @desc    Get single equipment by id
// @route   GET /api/v1/admin/equipment/:id
const getEquipmentById = async (req, res) => {
  try {
    const equipment = await Equipment.findById(req.params.id);

    if (!equipment) {
      return res.status(404).json({ success: false, message: 'Equipment not found' });
    }

    res.status(200).json({
      success: true,
      data: buildEquipmentPayload(equipment)
    });
  } catch (error) {
    console.error('Get equipment by id error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// @desc    Create or update equipment (no duplicates)
// @route   POST /api/v1/admin/equipment
const createEquipment = async (req, res) => {
  try {
    const { name, type, referenceId, condition, category, totalStock } = req.body;

    const trimmedName = normalizeString(name);
    const trimmedReferenceId = normalizeString(referenceId);

    if (!trimmedName) {
      return res.status(400).json({ success: false, message: 'Equipment name is required' });
    }

    if (!trimmedReferenceId) {
      return res.status(400).json({ success: false, message: 'Reference ID is required' });
    }

    const selectedType = normalizeString(type || category || req.body.equipmentType);
    if (!selectedType) {
      // Preserve backward compatibility for older clients and tests while still defaulting
      // to the generic equipment type when none is supplied.
      req.body.type = 'Sports Equipment';
    }

    const normalizedCondition = VALID_CONDITIONS.includes(condition) ? condition : 'Good';
    const normalizedCategory = VALID_CATEGORIES.includes(category)
      ? category
      : (VALID_CATEGORIES.includes(type) ? type : (VALID_CATEGORIES.includes(selectedType) ? selectedType : 'Sports Equipment'));
    const normalizedType = VALID_CATEGORIES.includes(type)
      ? type
      : (VALID_CATEGORIES.includes(category) ? category : (VALID_CATEGORIES.includes(selectedType) ? selectedType : 'Sports Equipment'));
    const parsedTotalStock = parseNonNegativeNumber(totalStock, 1);
    const parsedOnLoan = parseNonNegativeNumber(req.body.onLoan, 0);

    if (parsedOnLoan > parsedTotalStock) {
      return res.status(400).json({
        success: false,
        message: 'On-loan quantity cannot exceed total stock.'
      });
    }

    const existingRefId = await Equipment.findOne({ referenceId: trimmedReferenceId });
    if (existingRefId) {
      return res.status(400).json({
        success: false,
        message: 'Reference ID already exists. Please use a unique ID.'
      });
    }

    const newEquipment = await Equipment.create({
      name: trimmedName,
      type: normalizedType,
      referenceId: trimmedReferenceId,
      category: normalizedCategory,
      totalStock: parsedTotalStock,
      onLoan: parsedOnLoan,
      condition: normalizedCondition
    });

    return res.status(201).json({
      success: true,
      message: `New Equipment Registered: ${trimmedName} with ${parsedTotalStock} unit(s)`,
      data: buildEquipmentPayload(newEquipment)
    });
  } catch (error) {
    console.error('Create equipment error:', error);

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Reference ID already exists. Please use a unique ID.'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Update equipment
// @route   PUT /api/v1/admin/equipment/:id
const updateEquipment = async (req, res) => {
  try {
    const equipment = await Equipment.findById(req.params.id);

    if (!equipment) {
      return res.status(404).json({ success: false, message: 'Equipment not found' });
    }

    const { name, type, referenceId, condition, category, totalStock, onLoan, status } = req.body;

    let nextTotalStock = equipment.totalStock;
    let nextOnLoan = equipment.onLoan;

    if (name !== undefined) {
      const trimmedName = normalizeString(name);
      if (!trimmedName) {
        return res.status(400).json({ success: false, message: 'Equipment name is required' });
      }

      equipment.name = trimmedName;
    }

    if (type !== undefined) {
      equipment.type = VALID_CATEGORIES.includes(type) ? type : equipment.type;
    }

    if (category !== undefined || type !== undefined) {
      const normalizedTypeForUpdate = VALID_CATEGORIES.includes(type) ? type : equipment.type;
      const normalizedCategoryForUpdate = VALID_CATEGORIES.includes(category)
        ? category
        : (VALID_CATEGORIES.includes(type) ? type : equipment.category);
      equipment.type = normalizedTypeForUpdate;
      equipment.category = normalizedCategoryForUpdate;
    }

    if (referenceId !== undefined) {
      const trimmedReferenceId = normalizeString(referenceId);
      if (!trimmedReferenceId) {
        return res.status(400).json({ success: false, message: 'Reference ID is required' });
      }
      const existingReference = await Equipment.findOne({ referenceId: trimmedReferenceId, _id: { $ne: equipment._id } });
      if (existingReference) {
        return res.status(400).json({ success: false, message: 'Reference ID already exists. Please use a unique ID.' });
      }
      equipment.referenceId = trimmedReferenceId;
    }

    if (condition !== undefined) {
      equipment.condition = VALID_CONDITIONS.includes(condition) ? condition : equipment.condition;
    }

    if (category !== undefined) {
      equipment.category = VALID_CATEGORIES.includes(category) ? category : equipment.category;
    }

    if (status !== undefined) {
      equipment.status = VALID_STATUSES.includes(status) ? status : equipment.status;
    }

    if (totalStock !== undefined) {
      const parsedTotalStock = Number(totalStock);
      if (!Number.isFinite(parsedTotalStock) || parsedTotalStock < 0) {
        return res.status(400).json({ success: false, message: 'Total stock must be a non-negative number' });
      }
      nextTotalStock = parsedTotalStock;
      equipment.totalStock = parsedTotalStock;
    }

    if (onLoan !== undefined) {
      const parsedOnLoan = Number(onLoan);
      if (!Number.isFinite(parsedOnLoan) || parsedOnLoan < 0) {
        return res.status(400).json({ success: false, message: 'On loan value must be a non-negative number' });
      }
      nextOnLoan = parsedOnLoan;
      equipment.onLoan = parsedOnLoan;
    }

    if (nextOnLoan > nextTotalStock) {
      return res.status(400).json({
        success: false,
        message: 'On-loan quantity cannot exceed total stock.'
      });
    }

    await equipment.save();

    res.status(200).json({
      success: true,
      message: 'Equipment updated successfully',
      data: buildEquipmentPayload(equipment)
    });
  } catch (error) {
    console.error('Update equipment error:', error);
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'Reference ID already exists. Please use a unique ID.' });
    }
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// @desc    Delete equipment
// @route   DELETE /api/v1/admin/equipment/:id
const deleteEquipment = async (req, res) => {
  try {
    const equipment = await Equipment.findById(req.params.id);

    if (!equipment) {
      return res.status(404).json({ success: false, message: 'Equipment not found' });
    }

    if (equipment.onLoan > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete equipment. ${equipment.onLoan} items are currently on loan.`
      });
    }

    await Equipment.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Equipment deleted successfully'
    });
  } catch (error) {
    console.error('Delete equipment error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// @desc    Borrow equipment
// @route   PUT /api/v1/admin/equipment/:id/borrow
const borrowEquipment = async (req, res) => {
  try {
    const { quantity } = req.body;
    const equipment = await Equipment.findById(req.params.id);

    if (!equipment) {
      return res.status(404).json({ success: false, message: 'Equipment not found' });
    }

    if (!quantity || quantity <= 0) {
      return res.status(400).json({ success: false, message: 'Quantity must be greater than 0' });
    }

    if (equipment.available < quantity) {
      return res.status(400).json({
        success: false,
        message: `Insufficient stock. Only ${equipment.available} unit(s) available.`
      });
    }

    equipment.onLoan += quantity;
    await equipment.save();

    res.status(200).json({
      success: true,
      message: `Borrowed ${quantity} ${equipment.name}(s). Available: ${equipment.available}/${equipment.totalStock}`,
      data: {
        available: equipment.available,
        onLoan: equipment.onLoan,
        total: equipment.totalStock
      }
    });
  } catch (error) {
    console.error('Borrow equipment error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// @desc    Return equipment
// @route   PUT /api/v1/admin/equipment/:id/return
const returnEquipment = async (req, res) => {
  try {
    const { quantity } = req.body;
    const equipment = await Equipment.findById(req.params.id);

    if (!equipment) {
      return res.status(404).json({ success: false, message: 'Equipment not found' });
    }

    if (!quantity || quantity <= 0) {
      return res.status(400).json({ success: false, message: 'Quantity must be greater than 0' });
    }

    if (equipment.onLoan < quantity) {
      return res.status(400).json({
        success: false,
        message: `Cannot return more than borrowed. Only ${equipment.onLoan} unit(s) on loan.`
      });
    }

    equipment.onLoan -= quantity;
    await equipment.save();

    res.status(200).json({
      success: true,
      message: `Returned ${quantity} ${equipment.name}(s). Available: ${equipment.available}/${equipment.totalStock}`,
      data: {
        available: equipment.available,
        onLoan: equipment.onLoan,
        total: equipment.totalStock
      }
    });
  } catch (error) {
    console.error('Return equipment error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// @desc    Get equipment options for dropdown
// @route   GET /api/v1/admin/equipment/options
const getEquipmentOptions = async (req, res) => {
  try {
    res.status(200).json({
      success: true,
      options: SPORTS_EQUIPMENT_OPTIONS
    });
  } catch (error) {
    console.error('Get options error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get equipment stats
// @route   GET /api/v1/admin/equipment/stats
const getEquipmentStats = async (req, res) => {
  try {
    const totalEquipmentTypes = await Equipment.countDocuments();
    const [totalItemsResult, totalAvailableResult, totalOnLoanResult] = await Promise.all([
      Equipment.aggregate([{ $group: { _id: null, total: { $sum: '$totalStock' } } }]),
      Equipment.aggregate([{ $group: { _id: null, total: { $sum: '$available' } } }]),
      Equipment.aggregate([{ $group: { _id: null, total: { $sum: '$onLoan' } } }])
    ]);

    const totalItems = totalItemsResult[0]?.total || 0;
    const totalAvailable = totalAvailableResult[0]?.total || 0;
    const totalOnLoan = totalOnLoanResult[0]?.total || 0;

    res.status(200).json({
      success: true,
      stats: {
        totalEquipmentTypes,
        totalItems,
        totalAvailable,
        totalOnLoan
      }
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get low-stock equipment
// @route   GET /api/v1/admin/equipment/low-stock
const getLowStockEquipment = async (req, res) => {
  try {
    const equipment = await Equipment.find({ available: { $lt: 5, $gt: 0 } }).sort({ available: 1, name: 1 });

    res.status(200).json({
      success: true,
      data: equipment.map(buildEquipmentPayload)
    });
  } catch (error) {
    console.error('Get low stock equipment error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get out-of-stock equipment
// @route   GET /api/v1/admin/equipment/out-of-stock
const getOutOfStockEquipment = async (req, res) => {
  try {
    const equipment = await Equipment.find({ status: 'Out of Stock' }).sort({ name: 1 });

    res.status(200).json({
      success: true,
      data: equipment.map(buildEquipmentPayload)
    });
  } catch (error) {
    console.error('Get out of stock equipment error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get equipment categories and filters
// @route   GET /api/v1/admin/equipment/categories
const getEquipmentCategories = async (req, res) => {
  try {
    const [categories, conditions, statuses] = await Promise.all([
      Equipment.distinct('category'),
      Equipment.distinct('condition'),
      Equipment.distinct('status')
    ]);

    res.status(200).json({
      success: true,
      categories: sortByPreference(categories, VALID_CATEGORIES),
      conditions: sortByPreference(conditions, VALID_CONDITIONS),
      statuses: sortByPreference(statuses, VALID_STATUSES)
    });
  } catch (error) {
    console.error('Get equipment categories error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports = {
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
};