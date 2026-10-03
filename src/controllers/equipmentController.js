const mongoose = require('mongoose');
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

const normalizeTypeCode = (type) => normalizeString(type)
  .toUpperCase()
  .replace(/[^A-Z0-9]/g, '');

const EQUIPMENT_TYPE_CODES = new Map([
  ['BASKETBALL', '1B'],
  ['BASKETBALLS', '1B'],
  ['BALLS', '1B']
]);

const normalizeEquipmentCode = (name, type) => {
  const normalizedName = normalizeTypeCode(name);
  const normalizedType = normalizeTypeCode(type);
  return EQUIPMENT_TYPE_CODES.get(normalizedName)
    || EQUIPMENT_TYPE_CODES.get(normalizedType)
    || normalizedType;
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const parseQuantity = (value) => {
  if (!['number', 'string'].includes(typeof value)) return null;
  if (typeof value === 'string' && !/^\d+$/.test(value)) return null;
  const quantity = Number(value);
  return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : null;
};

const parseNonNegativeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const getNextEquipmentReferenceIds = async (typeCode, quantity, session, registeredAt = new Date()) => {
  const month = String(registeredAt.getMonth() + 1).padStart(2, '0');
  const day = String(registeredAt.getDate()).padStart(2, '0');
  const datePrefix = `${typeCode}${month}${day}`;
  let query = Equipment.find({
    referenceId: { $regex: `^${escapeRegex(datePrefix)}(\\d{3})$`, $options: 'i' }
  }).select('referenceId');

  if (session) query = query.session(session);
  const existing = await query.lean();
  const highestSequence = existing.reduce((highest, item) => {
    const match = String(item.referenceId || '').match(/(\d{3})$/);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);

  if (highestSequence + quantity > 999) {
    const sequenceError = new Error('The Reference ID sequence is exhausted for this equipment type and date.');
    sequenceError.code = 'REFERENCE_ID_SEQUENCE_EXHAUSTED';
    throw sequenceError;
  }

  return Array.from({ length: quantity }, (_, index) => (
    `${datePrefix}${String(highestSequence + index + 1).padStart(3, '0')}`
  ));
};

// @desc Preview equipment Reference IDs from persisted records
// @route GET /api/v1/admin/equipment/reference-ids
const getEquipmentReferenceIds = async (req, res) => {
  try {
    const typeCode = normalizeEquipmentCode(req.query.name, req.query.type);
    const quantity = parseQuantity(req.query.quantity);
    if (!typeCode) {
      return res.status(400).json({ success: false, message: 'A valid equipment type is required.' });
    }
    if (quantity === null) {
      return res.status(400).json({ success: false, message: 'Quantity must be a positive whole number.' });
    }

    const referenceIds = await getNextEquipmentReferenceIds(typeCode, quantity);
    return res.status(200).json({ success: true, referenceIds });
  } catch (error) {
    if (error.code === 'REFERENCE_ID_SEQUENCE_EXHAUSTED') {
      return res.status(409).json({ success: false, message: error.message });
    }
    console.error('Generate equipment Reference IDs error:', error);
    return res.status(500).json({ success: false, message: 'Unable to generate Reference IDs.' });
  }
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
    res.status(500).json({ success: false, message: 'An unexpected server error occurred. Please try again.' });
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
    res.status(500).json({ success: false, message: 'An unexpected server error occurred. Please try again.' });
  }
};

// @desc    Create or update equipment (no duplicates)
// @route   POST /api/v1/admin/equipment
const createEquipment = async (req, res) => {
  try {
    const { name, type, referenceId, condition, category, totalStock, quantity, referenceIds: requestedReferenceIds } = req.body;

    const trimmedName = normalizeString(name);
    const trimmedReferenceId = normalizeString(referenceId);

    if (!trimmedName) {
      return res.status(400).json({ success: false, message: 'Equipment name is required' });
    }

    if (quantity === undefined && !trimmedReferenceId) {
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

    if (quantity !== undefined) {
      const parsedQuantity = parseQuantity(quantity);
      if (parsedQuantity === null) {
        return res.status(400).json({ success: false, message: 'Quantity must be a positive whole number.' });
      }

      if (parsedOnLoan !== 0) {
        return res.status(400).json({ success: false, message: 'New equipment cannot have units on loan.' });
      }

      const prefix = normalizeEquipmentCode(name, type);
      if (!prefix) {
        return res.status(400).json({ success: false, message: 'A valid equipment type is required.' });
      }
      if (!Array.isArray(requestedReferenceIds)
        || requestedReferenceIds.length !== parsedQuantity
        || requestedReferenceIds.some((referenceId) => typeof referenceId !== 'string')) {
        return res.status(400).json({ success: false, message: 'Select every generated Reference ID before registering.' });
      }

      let session;
      let createdEquipment = [];
      const registeredAt = new Date();
      try {
        session = await mongoose.startSession();
        let attempts = 0;
        while (attempts < 5) {
          attempts += 1;
          try {
            await session.withTransaction(async () => {
              const currentReferenceIds = await getNextEquipmentReferenceIds(
                prefix,
                parsedQuantity,
                session,
                registeredAt
              );
              if (requestedReferenceIds.some((referenceId, index) => referenceId !== currentReferenceIds[index])) {
                const staleSequenceError = new Error('The generated Reference IDs are no longer current. Review and select the updated IDs.');
                staleSequenceError.code = 'STALE_REFERENCE_IDS';
                throw staleSequenceError;
              }
              const records = Array.from({ length: parsedQuantity }, (_, index) => ({
                name: trimmedName,
                type: prefix,
                referenceId: currentReferenceIds[index],
                category: normalizedCategory,
                totalStock: 1,
                onLoan: 0,
                condition: normalizedCondition
              }));
              createdEquipment = await Equipment.create(records, { session });
            });
            break;
          } catch (error) {
            if (error.code !== 11000 || attempts >= 5) throw error;
          }
        }
      } finally {
        if (session) {
          try {
            await session.endSession();
          } catch (error) {
            console.error('Unable to close equipment registration transaction:', error);
          }
        }
      }

      const data = createdEquipment.map(buildEquipmentPayload);
      const referenceIds = data.map((equipment) => equipment.referenceId);
      return res.status(201).json({
        success: true,
        message: `Registered ${data.length} ${trimmedName} unit(s): ${referenceIds.join(', ')}`,
        referenceIds,
        data
      });
    }

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
    if (error.code === 'STALE_REFERENCE_IDS') {
      return res.status(409).json({ success: false, message: error.message });
    }
    if (error.code === 'REFERENCE_ID_SEQUENCE_EXHAUSTED') {
      return res.status(409).json({ success: false, message: error.message });
    }
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
      message: 'An unexpected server error occurred. Please try again.'
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
    res.status(500).json({ success: false, message: 'An unexpected server error occurred. Please try again.' });
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
    res.status(500).json({ success: false, message: 'An unexpected server error occurred. Please try again.' });
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
    res.status(500).json({ success: false, message: 'An unexpected server error occurred. Please try again.' });
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
    res.status(500).json({ success: false, message: 'An unexpected server error occurred. Please try again.' });
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
  getEquipmentReferenceIds,
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