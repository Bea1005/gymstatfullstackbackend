const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
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
const getBorrowingEquipmentItems = (borrowing) => (
  Array.isArray(borrowing.equipmentItems) && borrowing.equipmentItems.length > 0
    ? borrowing.equipmentItems.map((item) => ({
        equipment: item.equipment,
        referenceIds: Array.isArray(item.referenceIds) ? item.referenceIds : [],
        referenceConditions: Array.isArray(item.referenceConditions) ? item.referenceConditions : [],
        quantity: Number(item.quantity) || item.referenceIds?.length || 0,
      }))
    : [{
        equipment: borrowing.equipment || '',
        referenceIds: Array.isArray(borrowing.referenceIds) ? borrowing.referenceIds : [],
        referenceConditions: Array.isArray(borrowing.referenceConditions) ? borrowing.referenceConditions : [],
        quantity: Number(borrowing.quantity || borrowing.qty) || borrowing.referenceIds?.length || 1,
      }]
);
const normalizeEquipmentItems = (equipmentItems, legacyData) => {
  const submittedItems = Array.isArray(equipmentItems) && equipmentItems.length > 0
    ? equipmentItems
    : [{
        equipment: legacyData.equipment,
        referenceIds: legacyData.referenceIds,
        referenceConditions: legacyData.referenceConditions,
        quantity: legacyData.quantity ?? legacyData.qty,
      }];

  return submittedItems.map((item) => {
    const referenceIds = Array.isArray(item.referenceIds)
      ? item.referenceIds.map((id) => normalizeText(id)).filter(Boolean)
      : [];
    const quantity = normalizeQuantity(item.quantity ?? referenceIds.length);
    return {
      equipment: normalizeText(item.equipment || item.name),
      referenceIds,
      referenceConditions: Array.isArray(item.referenceConditions) ? item.referenceConditions : [],
      quantity,
    };
  });
};
const buildBorrowingResponse = (borrowing) => {
  const equipmentItems = getBorrowingEquipmentItems(borrowing);
  const borrowDate = borrowing.borrowDate ? new Date(borrowing.borrowDate) : new Date();
  const returnedAt = borrowing.returnedAt ? new Date(borrowing.returnedAt) : null;
  return {
    id: borrowing._id,
    _id: borrowing._id,
    fullname: borrowing.Name || borrowing.fullname || '',
    contactNo: borrowing.contactNo || '',
    facebookAccount: borrowing.facebookAccount || '',
    equipment: borrowing.equipment || '',
    equipmentItems,
    referenceIds: borrowing.referenceIds || [],
    referenceConditions: borrowing.referenceConditions || [],
    qty: borrowing.quantity || borrowing.qty || 1,
    borrowTimestamp: borrowing.borrowTimestamp || formatBorrowTimestamp(borrowDate),
    returnDate: borrowing.returnDate || null,
    endTime: borrowing.endTime || '',
    returnedTimestamp: borrowing.returnedTimestamp || (returnedAt ? formatBorrowTimestamp(returnedAt) : null),
    status: borrowing.status === 'Completed' ? 'Returned' : (borrowing.status === 'Out Now' ? 'Out' : borrowing.status || 'Out'),
    condition: borrowing.condition || null,
    borrowDate: borrowDate,
    returnedAt
  };
};
const syncReferenceConditionsToEquipment = async (borrowing) => {
  if (!borrowing) return;

  const groups = getBorrowingEquipmentItems(borrowing);
  const allReferenceIds = groups.flatMap((group) => group.referenceIds);
  const fallbackConditions = Array.isArray(borrowing.referenceConditions)
    ? borrowing.referenceConditions
    : [];
  const fallbackCondition = ['Good', 'Damaged', 'Lost', 'Under Repair', 'Fair', 'Poor'].includes(borrowing.condition)
    ? borrowing.condition
    : null;
  let flattenedIndex = 0;

  for (const group of groups) {
    for (let index = 0; index < group.referenceIds.length; index += 1) {
      const referenceId = group.referenceIds[index];
      const equipmentItem = await Equipment.findOne({ referenceId });
      if (!equipmentItem) {
        throw new Error(`Equipment reference ID not found: ${referenceId}`);
      }

      const groupCondition = group.referenceConditions[index];
      const legacyCondition = fallbackConditions[flattenedIndex]
        || (fallbackConditions.length === 1 ? fallbackConditions[0] : null);
      const resolvedCondition = [legacyCondition, groupCondition, fallbackCondition]
        .find((value) => ['Good', 'Damaged', 'Lost', 'Under Repair', 'Fair', 'Poor'].includes(value))
        || 'Good';

      if (equipmentItem.condition !== resolvedCondition) {
        equipmentItem.condition = resolvedCondition;
        await equipmentItem.save();
      }
      flattenedIndex += 1;
    }
  }
  if (allReferenceIds.length !== flattenedIndex) {
    throw new Error('Borrowing reference IDs could not be synchronized.');
  }
};
const ensureEquipmentExists = async (equipmentName) => {
  const name = normalizeText(equipmentName);
  if (!name) return null;

  return Equipment.findOne({
    name: { $regex: `^${escapeRegExp(name)}$`, $options: 'i' }
  });
};
const adjustBorrowedEquipmentStock = async (equipmentName, referenceIds, quantity, adjustment, session) => {
  const nameFilter = { name: { $regex: `^${escapeRegExp(normalizeText(equipmentName))}$`, $options: 'i' } };
  const validReferenceIds = Array.isArray(referenceIds) ? referenceIds.filter(Boolean) : [];

  if (validReferenceIds.length === 0) {
    const equipmentItemQuery = Equipment.findOne(nameFilter);
    const equipmentItem = await (session ? equipmentItemQuery.session(session) : equipmentItemQuery);
    if (equipmentItem) {
      equipmentItem.onLoan = Math.max(0, (equipmentItem.onLoan || 0) + (quantity * adjustment));
      await equipmentItem.save(session ? { session } : undefined);
    }
    return;
  }

  const equipmentQuery = Equipment.find({
    ...nameFilter,
    referenceId: { $in: validReferenceIds }
  });
  const equipmentItems = await (session ? equipmentQuery.session(session) : equipmentQuery);
  if (equipmentItems.length !== validReferenceIds.length) {
    throw new Error('One or more borrowed equipment reference IDs could not be found.');
  }

  const equipmentByReferenceId = new Map(equipmentItems.map((item) => [item.referenceId, item]));
  for (const referenceId of validReferenceIds) {
    const equipmentItem = equipmentByReferenceId.get(referenceId);
    const onLoan = Number(equipmentItem.onLoan) || 0;
    const available = Math.max(0, Number(equipmentItem.available ?? (equipmentItem.totalStock - onLoan)) || 0);
    if (adjustment > 0 && available < 1) {
      throw new Error(`Reference ID ${referenceId} is no longer available.`);
    }
    if (adjustment < 0 && onLoan < 1) {
      throw new Error(`Reference ID ${referenceId} is not currently borrowed.`);
    }
    equipmentItem.onLoan = onLoan + adjustment;
    await equipmentItem.save(session ? { session } : undefined);
  }
};
const adjustBorrowingEquipmentStock = async (borrowing, adjustment) => {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const item of getBorrowingEquipmentItems(borrowing)) {
        await adjustBorrowedEquipmentStock(
          item.equipment,
          item.referenceIds,
          item.quantity,
          adjustment,
          session
        );
      }
    });
  } finally {
    await session.endSession();
  }
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
    const {
      Name,
      fullname,
      contactNo,
      facebookAccount,
      equipmentItems,
      equipment,
      quantity,
      qty,
      referenceIds,
      referenceConditions,
      borrowTimestamp,
      endTime,
      returnedTimestamp,
      status,
      condition
    } = req.body;
    const borrowerName = normalizeText(Name || fullname);
    const normalizedBorrowTimestamp = normalizeTimestampObject(borrowTimestamp);
    const normalizedReturnedTimestamp = returnedTimestamp && typeof returnedTimestamp === 'object'
      ? normalizeTimestampObject(returnedTimestamp)
      : null;
    const itemGroups = normalizeEquipmentItems(equipmentItems, {
      equipment,
      quantity,
      qty,
      referenceIds,
      referenceConditions,
    });

    if (!borrowerName || itemGroups.length === 0) {
      return res.status(400).json({ error: 'Borrower and equipment are required.' });
    }
    if (itemGroups.some((item) => (
      !item.equipment
      || !Number.isInteger(item.quantity)
      || item.quantity < 1
      || item.quantity !== item.referenceIds.length
    ))) {
      return res.status(400).json({ error: 'Each equipment type must have valid Reference IDs and a matching quantity.' });
    }
    if (new Set(itemGroups.map((item) => item.equipment.toLowerCase())).size !== itemGroups.length) {
      return res.status(400).json({ error: 'Each equipment type can only be selected once.' });
    }

    const selectedReferenceIds = itemGroups.flatMap((item) => item.referenceIds);
    if (new Set(selectedReferenceIds).size !== selectedReferenceIds.length) {
      return res.status(400).json({ error: 'Reference IDs must be unique across the transaction.' });
    }
    const selectedQuantity = selectedReferenceIds.length;
    const suppliedQuantity = quantity ?? qty;
    if (suppliedQuantity !== undefined && normalizeQuantity(suppliedQuantity) !== selectedQuantity) {
      return res.status(400).json({ error: 'Quantity must match the number of selected Reference IDs.' });
    }
    const selectedEquipmentNames = itemGroups.map((item) => item.equipment);

    for (const equipmentName of selectedEquipmentNames) {
      const equipmentRecord = await ensureEquipmentExists(equipmentName);
      if (!equipmentRecord) {
        return res.status(404).json({ error: `Equipment not found in inventory: ${equipmentName}.` });
      }
    }

    const borrowDate = new Date();
    let borrowing;
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const availableItemsByReferenceId = new Map();
        for (const group of itemGroups) {
          const referenceItems = await Equipment.find({
            referenceId: { $in: group.referenceIds },
            name: { $regex: `^${escapeRegExp(group.equipment)}$`, $options: 'i' }
          }).session(session);
          const itemsByReferenceId = new Map(referenceItems.map((item) => [item.referenceId, item]));
          if (group.referenceIds.some((referenceId) => !itemsByReferenceId.has(referenceId))) {
            throw Object.assign(
              new Error(`One or more Reference IDs do not belong to ${group.equipment}.`),
              { statusCode: 400 }
            );
          }

          for (const referenceId of group.referenceIds) {
            const item = itemsByReferenceId.get(referenceId);
            const available = Math.max(
              0,
              Number(item.available ?? (item.totalStock - (item.onLoan || 0))) || 0
            );
            if (available < 1) {
              throw Object.assign(
                new Error(`Reference ID ${referenceId} is no longer available.`),
                { statusCode: 400 }
              );
            }
            availableItemsByReferenceId.set(referenceId, item);
          }
        }

        for (const referenceId of selectedReferenceIds) {
          const referenceItem = availableItemsByReferenceId.get(referenceId);
          referenceItem.onLoan = (referenceItem.onLoan || 0) + 1;
          await referenceItem.save({ session });
        }

        const borrowTimestampValue = normalizedBorrowTimestamp.date
          ? new Date(`${normalizedBorrowTimestamp.date} ${normalizedBorrowTimestamp.time || '09:00 AM'}`)
          : borrowDate;
        const savedEquipmentItems = itemGroups.map((item) => ({
          equipment: item.equipment,
          referenceIds: item.referenceIds,
          referenceConditions: item.referenceIds.map((referenceId, index) => {
            const submittedCondition = item.referenceConditions[index]
              || referenceConditions?.[selectedReferenceIds.indexOf(referenceId)];
            return submittedCondition || availableItemsByReferenceId.get(referenceId).condition || 'Good';
          }),
          quantity: item.referenceIds.length,
        }));

        [borrowing] = await Borrowing.create([{
          Name: borrowerName,
          fullname: borrowerName,
          contactNo: normalizeText(contactNo),
          facebookAccount: normalizeText(facebookAccount),
          equipment: selectedEquipmentNames.join(', '),
          equipmentItems: savedEquipmentItems,
          referenceIds: selectedReferenceIds,
          referenceConditions: savedEquipmentItems.flatMap((item) => item.referenceConditions),
          quantity: selectedQuantity,
          qty: selectedQuantity,
          borrowTimestamp: normalizedBorrowTimestamp.date || normalizedBorrowTimestamp.time
            ? normalizedBorrowTimestamp
            : formatBorrowTimestamp(borrowDate),
          endTime: normalizeText(endTime),
          returnedTimestamp: normalizedReturnedTimestamp,
          status: status || 'Out Now',
          condition: condition || null,
          borrowDate: borrowTimestampValue,
          borrowedBy: normalizeBorrowedBy(req.user?.id || req.user?._id)
        }], { session });
      });
    } finally {
      await session.endSession();
    }

    await borrowing.populate('borrowedBy', 'fullname email');
    res.status(201).json(buildBorrowingResponse(borrowing));
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('Create borrowing error:', error);
    res.status(500).json({ error: 'An unexpected server error occurred. Please try again.' });
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

    if (updateData.status === 'Returned' && !['Returned', 'Completed'].includes(borrowing.status)) {
      await adjustBorrowingEquipmentStock(borrowing, -1);
    }

    if (updateData.status === 'Out' && ['Returned', 'Completed'].includes(borrowing.status)) {
      await adjustBorrowingEquipmentStock(borrowing, 1);
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
    res.status(500).json({ error: 'An unexpected server error occurred. Please try again.' });
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

    borrowing.referenceConditions = requestedReferenceConditions.length > 0
      ? requestedReferenceConditions
      : borrowing.referenceConditions || [];
    await adjustBorrowingEquipmentStock(borrowing, -1);

    const returnedAt = req.body.returnedAt ? new Date(req.body.returnedAt) : new Date();
    borrowing.status = 'Completed';
    borrowing.returnedAt = returnedAt;
    borrowing.returnedTimestamp = req.body.returnedTimestamp || formatBorrowTimestamp(returnedAt);
    borrowing.condition = fallbackCondition;
    await borrowing.save();

    await borrowing.populate('borrowedBy', 'fullname email');
    res.json(buildBorrowingResponse(borrowing));
  } catch (error) {
    console.error('Return item error:', error);
    res.status(500).json({ error: 'An unexpected server error occurred. Please try again.' });
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
      await adjustBorrowingEquipmentStock(borrowing, -1);
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