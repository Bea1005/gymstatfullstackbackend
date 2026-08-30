const express = require('express');
const router = express.Router();
const Borrowing = require('../models/Borrowing');
const Equipment = require('../models/Equipment');
const { protect, authorize } = require('../middleware/auth');

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normalizeQuantity = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};
const normalizeBorrowedBy = (value) => {
  if (!value) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return /^[a-fA-F0-9]{24}$/.test(trimmed) ? trimmed : null;
  }
  if (typeof value === 'object' && value !== null && value._id) {
    const idValue = String(value._id).trim();
    return /^[a-fA-F0-9]{24}$/.test(idValue) ? idValue : null;
  }
  return null;
};
const formatBorrowTimestamp = (dateValue) => {
  const date = dateValue ? new Date(dateValue) : new Date();
  return {
    date: date.toISOString().split('T')[0],
    time: date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  };
};
const normalizeTimestampObject = (value) => {
  if (!value || typeof value !== 'object') {
    return { date: '', time: '' };
  }

  return {
    date: String(value.date || '').trim(),
    time: String(value.time || '').trim()
  };
};
const buildBorrowingResponse = (borrowing) => {
  const borrowDate = borrowing.borrowDate ? new Date(borrowing.borrowDate) : new Date();
  const returnedAt = borrowing.returnedAt ? new Date(borrowing.returnedAt) : null;
  return {
    id: borrowing._id,
    _id: borrowing._id,
    fullname: borrowing.Name || borrowing.fullname || '',
    contactNo: borrowing.contactNo || '',
    facebookAccount: borrowing.facebookAccount || '',
    equipment: borrowing.equipment || '',
    referenceIds: borrowing.referenceIds || [],
    referenceConditions: borrowing.referenceConditions || [],
    qty: borrowing.quantity || borrowing.qty || 1,
    borrowTimestamp: borrowing.borrowTimestamp || formatBorrowTimestamp(borrowDate),
    endTime: borrowing.endTime || '',
    returnedTimestamp: borrowing.returnedTimestamp || (returnedAt ? formatBorrowTimestamp(returnedAt) : null),
    status: borrowing.status === 'Completed' ? 'Returned' : (borrowing.status === 'Out Now' ? 'Out' : borrowing.status || 'Out'),
    condition: borrowing.condition || null,
    borrowDate: borrowDate,
    returnedAt
  };
};
const syncReferenceConditionsToEquipment = async (borrowing) => {
  if (!borrowing || !Array.isArray(borrowing.referenceIds) || borrowing.referenceIds.length === 0) {
    return;
  }

  const referenceIds = borrowing.referenceIds.filter(Boolean);
  const referenceConditions = Array.isArray(borrowing.referenceConditions)
    ? borrowing.referenceConditions.filter((condition) => typeof condition === 'string')
    : [];
  const fallbackCondition = ['Good', 'Damaged', 'Lost', 'Under Repair', 'Fair', 'Poor'].includes(borrowing.condition)
    ? borrowing.condition
    : null;

  const targetReferenceIds = (() => {
    if (referenceConditions.length === 1 && referenceIds.length > 1) {
      return [referenceIds[0]];
    }
    return referenceIds;
  })();

  for (let index = 0; index < targetReferenceIds.length; index += 1) {
    const referenceId = targetReferenceIds[index];
    const equipmentItem = await Equipment.findOne({ referenceId });

    if (!equipmentItem) {
      throw new Error(`Equipment reference ID not found: ${referenceId}`);
    }

    let resolvedCondition = fallbackCondition || 'Good';

    if (referenceConditions.length === targetReferenceIds.length) {
      const conditionAtIndex = referenceConditions[index];
      if (['Good', 'Damaged', 'Lost', 'Under Repair', 'Fair', 'Poor'].includes(conditionAtIndex)) {
        resolvedCondition = conditionAtIndex;
      }
    } else if (referenceConditions.length === 1 && index === 0) {
      const singleCondition = referenceConditions[0];
      if (['Good', 'Damaged', 'Lost', 'Under Repair', 'Fair', 'Poor'].includes(singleCondition)) {
        resolvedCondition = singleCondition;
      }
    } else if (referenceConditions.length > 0) {
      const conditionAtIndex = referenceConditions[index];
      if (['Good', 'Damaged', 'Lost', 'Under Repair', 'Fair', 'Poor'].includes(conditionAtIndex)) {
        resolvedCondition = conditionAtIndex;
      }
    }

    if (equipmentItem.condition !== resolvedCondition) {
      equipmentItem.condition = resolvedCondition;
      await equipmentItem.save();
    }
  }
};
const ensureEquipmentExists = async (equipmentName) => {
  const name = normalizeText(equipmentName);
  if (!name) return null;

  return Equipment.findOne({
    name: { $regex: `^${escapeRegExp(name)}$`, $options: 'i' }
  });
};

// @desc    Get all borrowing records
// @route   GET /api/v1/admin/borrowing
// @access  Private/Admin
router.get('/admin/borrowing', protect, authorize('admin'), async (req, res) => {
  try {
    const borrowings = await Borrowing.find().populate('borrowedBy', 'fullname email').sort({ borrowDate: -1 });
    res.json(borrowings.map(buildBorrowingResponse));
  } catch (error) {
    console.error('Get borrowing records error:', error);
    res.status(500).json({ error: 'Failed to fetch borrowings' });
  }
});

// @desc    Create new borrowing transaction
// @route   POST /api/v1/admin/borrowing
// @access  Private/Admin
router.post('/admin/borrowing', protect, authorize('admin'), async (req, res) => {
  try {
    const { Name, fullname, contactNo, facebookAccount, equipment, quantity, qty, referenceIds, referenceConditions, borrowTimestamp, endTime, returnedTimestamp, status, condition } = req.body;
    const borrowerName = normalizeText(Name || fullname);
    const equipmentName = normalizeText(equipment);
    const selectedReferenceIds = Array.isArray(referenceIds) ? referenceIds.filter(Boolean) : [];
    const selectedQuantity = normalizeQuantity(quantity ?? qty ?? selectedReferenceIds.length);
    const normalizedBorrowTimestamp = normalizeTimestampObject(borrowTimestamp);
    const normalizedReturnedTimestamp = returnedTimestamp && typeof returnedTimestamp === 'object'
      ? normalizeTimestampObject(returnedTimestamp)
      : null;

    if (!borrowerName || !equipmentName || selectedReferenceIds.length === 0 || selectedQuantity <= 0) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (selectedQuantity !== selectedReferenceIds.length) {
      return res.status(400).json({ error: 'Quantity must match the number of selected reference IDs' });
    }

    const equipmentItem = await ensureEquipmentExists(equipmentName);
    if (!equipmentItem) {
      return res.status(404).json({
        error: 'Equipment not found in inventory. Please register it first.'
      });
    }

    const available = Math.max(0, (equipmentItem.available ?? (equipmentItem.totalStock - (equipmentItem.onLoan || 0))));
    if (available < selectedQuantity) {
      return res.status(400).json({ error: `Insufficient stock. Only ${available} available.` });
    }

    equipmentItem.onLoan = (equipmentItem.onLoan || 0) + selectedQuantity;
    await equipmentItem.save();

    const borrowDate = new Date();
    const borrowing = await Borrowing.create({
      Name: borrowerName,
      fullname: borrowerName,
      contactNo: normalizeText(contactNo),
      facebookAccount: normalizeText(facebookAccount),
      equipment: equipmentName,
      referenceIds: selectedReferenceIds,
      referenceConditions: Array.isArray(referenceConditions) ? referenceConditions : [],
      quantity: selectedQuantity,
      qty: selectedQuantity,
      borrowTimestamp: normalizedBorrowTimestamp.date || normalizedBorrowTimestamp.time
        ? normalizedBorrowTimestamp
        : formatBorrowTimestamp(borrowDate),
      endTime: normalizeText(endTime),
      returnedTimestamp: normalizedReturnedTimestamp,
      status: status || 'Out Now',
      condition: condition || null,
      borrowDate,
      borrowedBy: normalizeBorrowedBy(req.user?.id || req.user?._id)
    });

    await borrowing.populate('borrowedBy', 'fullname email');
    res.status(201).json(buildBorrowingResponse(borrowing));
  } catch (error) {
    console.error('Create borrowing error:', error);
    res.status(500).json({ error: 'Failed to create borrowing record', details: error.message });
  }
});

// @desc    Update borrowing record (full update)
// @route   PUT /api/v1/admin/borrowing/:id
// @access  Private/Admin
router.put('/admin/borrowing/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const borrowing = await Borrowing.findById(id);

    if (!borrowing) {
      return res.status(404).json({ error: 'Borrowing record not found' });
    }

    if (updateData.status === 'Returned' && borrowing.status !== 'Returned') {
      const equipmentItem = await Equipment.findOne({ name: borrowing.equipment });
      if (equipmentItem) {
        equipmentItem.onLoan = Math.max(0, (equipmentItem.onLoan || 0) - (borrowing.quantity || borrowing.qty || 1));
        await equipmentItem.save();
      }
    }

    if (updateData.status === 'Out' && borrowing.status === 'Returned') {
      const equipmentItem = await Equipment.findOne({ name: borrowing.equipment });
      if (equipmentItem) {
        equipmentItem.onLoan = (equipmentItem.onLoan || 0) + (borrowing.quantity || borrowing.qty || 1);
        await equipmentItem.save();
      }
    }

    const updatedFields = {
      ...updateData,
      Name: updateData.fullname || borrowing.Name,
      fullname: updateData.fullname || borrowing.fullname,
      contactNo: updateData.contactNo !== undefined ? updateData.contactNo : borrowing.contactNo,
      facebookAccount: updateData.facebookAccount !== undefined ? updateData.facebookAccount : borrowing.facebookAccount,
      quantity: updateData.qty || updateData.quantity || borrowing.quantity,
      qty: updateData.qty || updateData.quantity || borrowing.qty,
      endTime: updateData.endTime !== undefined ? updateData.endTime : borrowing.endTime
    };

    if (updateData.status === 'Returned' && updateData.returnedTimestamp) {
      updatedFields.returnedAt = new Date(`${updateData.returnedTimestamp.date} ${updateData.returnedTimestamp.time}`);
      updatedFields.returnedTimestamp = updateData.returnedTimestamp;
    }

    if (updateData.status === 'Out' && updateData.returnedTimestamp === null) {
      updatedFields.returnedAt = null;
      updatedFields.returnedTimestamp = null;
    }

    const updatedBorrowing = await Borrowing.findByIdAndUpdate(id, updatedFields, { new: true, runValidators: true });
    if (!updatedBorrowing) {
      return res.status(404).json({ error: 'Borrowing record not found' });
    }

    if (Array.isArray(updatedBorrowing.referenceIds) && updatedBorrowing.referenceIds.length > 0) {
      await syncReferenceConditionsToEquipment(updatedBorrowing);
    }

    if (updatedBorrowing.borrowedBy) {
      await updatedBorrowing.populate('borrowedBy', 'fullname email');
    }

    res.json(buildBorrowingResponse(updatedBorrowing));
  } catch (error) {
    console.error('Update borrowing error:', error);
    res.status(500).json({ error: 'Failed to update borrowing record', details: error.message });
  }
});

// @desc    Return item
// @route   PUT /api/v1/admin/borrowing/:id/return
// @access  Private/Admin
router.put('/admin/borrowing/:id/return', protect, authorize('admin'), async (req, res) => {
  try {
    const borrowing = await Borrowing.findById(req.params.id);
    if (!borrowing) {
      return res.status(404).json({ error: 'Borrowing record not found' });
    }
    if (borrowing.status === 'Completed') {
      return res.status(400).json({ error: 'Item already returned' });
    }

    const validConditions = ['Good', 'Damaged', 'Lost'];
    const requestedReferenceIds = Array.isArray(req.body.referenceIds) && req.body.referenceIds.length > 0
      ? req.body.referenceIds.filter(Boolean)
      : (Array.isArray(borrowing.referenceIds) ? borrowing.referenceIds.filter(Boolean) : []);
    const requestedReferenceConditions = Array.isArray(req.body.referenceConditions)
      ? req.body.referenceConditions
      : (Array.isArray(borrowing.referenceConditions) ? borrowing.referenceConditions : []);
    const fallbackCondition = validConditions.includes(req.body.condition)
      ? req.body.condition
      : (validConditions.includes(borrowing.condition) ? borrowing.condition : 'Good');

    for (let index = 0; index < requestedReferenceIds.length; index += 1) {
      const referenceId = requestedReferenceIds[index];
      const referenceCondition = requestedReferenceConditions[index] || requestedReferenceConditions[0] || fallbackCondition;
      const normalizedCondition = validConditions.includes(referenceCondition) ? referenceCondition : fallbackCondition;
      const equipmentItem = await Equipment.findOne({ referenceId });

      if (!equipmentItem) {
        return res.status(400).json({ error: `Equipment reference ID not found: ${referenceId}` });
      }

      equipmentItem.condition = normalizedCondition;
      await equipmentItem.save();
    }

    const quantity = borrowing.quantity || borrowing.qty || 1;
    const equipmentItem = await Equipment.findOne({ name: borrowing.equipment });
    if (equipmentItem) {
      equipmentItem.onLoan = Math.max(0, (equipmentItem.onLoan || 0) - quantity);
      await equipmentItem.save();
    }

    const returnedAt = req.body.returnedAt ? new Date(req.body.returnedAt) : new Date();
    borrowing.status = 'Completed';
    borrowing.returnedAt = returnedAt;
    borrowing.returnedTimestamp = req.body.returnedTimestamp || formatBorrowTimestamp(returnedAt);
    borrowing.referenceConditions = requestedReferenceConditions.length > 0
      ? requestedReferenceConditions
      : borrowing.referenceConditions || [];
    borrowing.condition = fallbackCondition;
    await borrowing.save();

    await borrowing.populate('borrowedBy', 'fullname email');
    res.json(buildBorrowingResponse(borrowing));
  } catch (error) {
    console.error('Return item error:', error);
    res.status(500).json({ error: error.message || 'Server error' });
  }
});

// @desc    Delete borrowing record
// @route   DELETE /api/v1/admin/borrowing/:id
// @access  Private/Admin
router.delete('/admin/borrowing/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const borrowing = await Borrowing.findById(req.params.id);
    if (!borrowing) {
      return res.status(404).json({ error: 'Borrowing record not found' });
    }

    if (borrowing.status === 'Out Now' || borrowing.status === 'Out') {
      const equipmentItem = await Equipment.findOne({ name: borrowing.equipment });
      if (equipmentItem) {
        equipmentItem.onLoan = Math.max(0, (equipmentItem.onLoan || 0) - (borrowing.quantity || borrowing.qty || 1));
        await equipmentItem.save();
      }
    }

    await Borrowing.findByIdAndDelete(req.params.id);
    res.json({ message: 'Borrowing record deleted successfully' });
  } catch (error) {
    console.error('Delete borrowing error:', error);
    res.status(500).json({ error: 'Failed to delete borrowing record' });
  }
});

// @desc    Get equipment with reference IDs
// @route   GET /api/v1/admin/equipment-with-refs
// @access  Private/Admin
router.get('/admin/equipment-with-refs', protect, authorize('admin'), async (req, res) => {
  try {
    const equipment = await Equipment.find();
    const equipmentWithRefs = {};
    equipment.forEach((item) => {
      const refs = (item.referenceIds || []).length > 0
        ? item.referenceIds.map((ref) => ({
            id: typeof ref === 'string' ? ref : (ref.id || ref),
            condition: ref.condition || 'Good'
          }))
        : [];
      if (item.name) {
        equipmentWithRefs[item.name] = refs;
      }
    });
    res.json(equipmentWithRefs);
  } catch (error) {
    console.error('Get equipment with refs error:', error);
    res.status(500).json({ error: 'Failed to fetch equipment' });
  }
});

module.exports = router;