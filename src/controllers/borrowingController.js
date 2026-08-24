const Borrowing = require('../models/Borrowing');
const Equipment = require('../models/Equipment');

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');
const normalizeTimestampObject = (value) => {
  if (!value || typeof value !== 'object') {
    return { date: '', time: '' };
  }

  return {
    date: String(value.date || '').trim(),
    time: String(value.time || '').trim()
  };
};
const normalizeQuantity = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
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

// @desc    Get all borrowing records
// @route   GET /api/borrowings
// @access  Private/Admin
const getBorrowingRecords = async (req, res) => {
  try {
    const borrowings = await Borrowing.find()
      .populate('borrowedBy', 'fullname email')
      .sort({ borrowDate: -1 });

    // Transform to match frontend expected format
    const formattedBorrowings = borrowings.map(b => ({
      id: b._id,
      _id: b._id,
      fullname: b.Name || b.fullname || '',
      contactNo: b.contactNo || '',
      facebookAccount: b.facebookAccount || '',
      equipment: b.equipment || '',
      referenceIds: b.referenceIds || [],
      referenceConditions: b.referenceConditions || [],
      qty: b.quantity || b.qty || 1,
      borrowTimestamp: b.borrowTimestamp || {
        date: b.borrowDate ? b.borrowDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        time: b.borrowDate ? b.borrowDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '09:00 AM'
      },
      endTime: b.endTime || '',
      returnedTimestamp: b.returnedTimestamp || (b.returnedAt ? {
        date: b.returnedAt.toISOString().split('T')[0],
        time: b.returnedAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
      } : null),
      status: b.status === 'Completed' ? 'Returned' : (b.status === 'Out Now' ? 'Out' : b.status || 'Out'),
      condition: b.condition || null,
      borrowDate: b.borrowDate,
      returnedAt: b.returnedAt,
      Name: b.Name,
      quantity: b.quantity
    }));
    
    res.status(200).json(formattedBorrowings);
  } catch (error) {
    console.error('Get borrowing records error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Create new borrowing transaction
// @route   POST /api/borrowings
// @access  Private/Admin
const createBorrowing = async (req, res) => {
  try {
    const {
      Name,
      fullname,
      contactNo,
      facebookAccount,
      equipment,
      referenceIds,
      referenceConditions,
      qty,
      quantity,
      borrowTimestamp,
      endTime,
      returnedTimestamp,
      status,
      condition
    } = req.body;

    const borrowerName = normalizeText(Name || fullname);
    const equipmentName = normalizeText(equipment);
    const selectedReferenceIds = Array.isArray(referenceIds) ? referenceIds.filter(Boolean) : [];
    const requestedQuantity = normalizeQuantity(quantity ?? qty ?? selectedReferenceIds.length);
    const normalizedBorrowTimestamp = normalizeTimestampObject(borrowTimestamp);
    const normalizedReturnedTimestamp = returnedTimestamp && typeof returnedTimestamp === 'object'
      ? normalizeTimestampObject(returnedTimestamp)
      : null;

    // Validate required fields
    if (!borrowerName || !equipmentName) {
      return res.status(400).json({ message: 'Please fill in all fields' });
    }

    if (!Number.isFinite(requestedQuantity) || requestedQuantity < 1) {
      return res.status(400).json({ message: 'Quantity must be at least 1' });
    }

    const normalizedReferenceIds = selectedReferenceIds.length > 0
      ? selectedReferenceIds
      : Array.from({ length: requestedQuantity }, (_, index) => `AUTO-${Date.now()}-${index + 1}`);

    if (requestedQuantity !== normalizedReferenceIds.length) {
      return res.status(400).json({ message: 'Quantity must match the number of selected reference IDs' });
    }

    // Check for existing active borrowing
    const existingBorrowing = await Borrowing.findOne({
      $or: [
        { Name: borrowerName, equipment: equipmentName, status: 'Out Now' },
        { fullname: borrowerName, equipment: equipmentName, status: 'Out' }
      ]
    });

    if (existingBorrowing) {
      return res.status(409).json({ message: 'A matching active borrowing already exists.' });
    }

    // Check if equipment exists and update stock
    const equipmentItem = await Equipment.findOne({ name: equipmentName });

    if (!equipmentItem) {
      return res.status(404).json({ message: 'Equipment not found' });
    }

    const totalQuantity = Number(equipmentItem.quantity ?? equipmentItem.totalStock ?? 0) || 0;
    const onLoan = Number(equipmentItem.onLoan ?? 0) || 0;
    const availableQuantity = Number.isFinite(equipmentItem.available)
      ? Number(equipmentItem.available)
      : Math.max(0, totalQuantity - onLoan);

    if (availableQuantity < requestedQuantity) {
      return res.status(400).json({
        message: `Insufficient stock. Only ${availableQuantity} available.`
      });
    }

    equipmentItem.onLoan = (Number(equipmentItem.onLoan) || 0) + requestedQuantity;
    await equipmentItem.save();

    // Create borrowing record
    const borrowingDate = normalizedBorrowTimestamp.date
      ? new Date(`${normalizedBorrowTimestamp.date} ${normalizedBorrowTimestamp.time || '09:00 AM'}`)
      : new Date();

    const borrowingData = {
      Name: borrowerName,
      fullname: borrowerName,
      contactNo: normalizeText(contactNo),
      facebookAccount: normalizeText(facebookAccount),
      equipment: equipmentName,
      referenceIds: normalizedReferenceIds,
      referenceConditions: referenceConditions || [],
      quantity: requestedQuantity,
      qty: requestedQuantity,
      borrowTimestamp: normalizedBorrowTimestamp.date || normalizedBorrowTimestamp.time
        ? normalizedBorrowTimestamp
        : {
            date: new Date().toISOString().split('T')[0],
            time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
          },
      endTime: normalizeText(endTime),
      returnedTimestamp: normalizedReturnedTimestamp,
      status: status || 'Out',
      condition: condition || null,
      borrowDate: borrowingDate,
      borrowedBy: normalizeBorrowedBy(req.user?.id || req.user?._id)
    };

    const borrowing = await Borrowing.create(borrowingData);

    // Populate user info if available
    if (borrowing.borrowedBy) {
      await borrowing.populate('borrowedBy', 'fullname email');
    }

    // Return in frontend expected format
    res.status(201).json({
      id: borrowing._id,
      _id: borrowing._id,
      fullname: borrowing.Name || borrowing.fullname || '',
      contactNo: borrowing.contactNo || '',
      facebookAccount: borrowing.facebookAccount || '',
      equipment: borrowing.equipment || '',
      referenceIds: borrowing.referenceIds || [],
      referenceConditions: borrowing.referenceConditions || [],
      qty: borrowing.quantity || borrowing.qty || 1,
      borrowTimestamp: borrowing.borrowTimestamp || {
        date: borrowing.borrowDate ? borrowing.borrowDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        time: borrowing.borrowDate ? borrowing.borrowDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '09:00 AM'
      },
      endTime: borrowing.endTime || '',
      returnedTimestamp: borrowing.returnedTimestamp || null,
      status: borrowing.status || 'Out',
      condition: borrowing.condition || null,
      borrowDate: borrowing.borrowDate,
      message: 'Borrowing transaction created successfully'
    });
  } catch (error) {
    console.error('Create borrowing error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Update borrowing record (full update)
// @route   PUT /api/borrowings/:id
// @access  Private/Admin
const updateBorrowingRecord = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    const borrowing = await Borrowing.findById(id);
    if (!borrowing) {
      return res.status(404).json({ message: 'Borrowing record not found' });
    }
    
    // Handle status change from Out to Returned
    if (updateData.status === 'Returned' && borrowing.status !== 'Returned' && borrowing.status !== 'Completed') {
      // Update equipment stock when returning
      const equipmentItem = await Equipment.findOne({ name: borrowing.equipment });
      if (equipmentItem) {
        equipmentItem.onLoan = Math.max(0, (equipmentItem.onLoan || 0) - (borrowing.quantity || borrowing.qty || 1));
        await equipmentItem.save();
      }
    }
    
    // Handle status change from Returned back to Out (undo return)
    if (updateData.status === 'Out' && (borrowing.status === 'Returned' || borrowing.status === 'Completed')) {
      // Reverse stock update
      const equipmentItem = await Equipment.findOne({ name: borrowing.equipment });
      if (equipmentItem) {
        equipmentItem.onLoan = (equipmentItem.onLoan || 0) + (borrowing.quantity || borrowing.qty || 1);
        await equipmentItem.save();
      }
    }
    
    // Update borrowing record
    const updatedFields = {
      ...updateData,
      // Map frontend field names to backend field names
      Name: updateData.fullname || borrowing.Name,
      fullname: updateData.fullname || borrowing.fullname,
      contactNo: updateData.contactNo !== undefined ? updateData.contactNo : borrowing.contactNo,
      facebookAccount: updateData.facebookAccount !== undefined ? updateData.facebookAccount : borrowing.facebookAccount,
      quantity: updateData.qty || updateData.quantity || borrowing.quantity,
      qty: updateData.qty || updateData.quantity || borrowing.qty,
      endTime: updateData.endTime !== undefined ? updateData.endTime : borrowing.endTime,
      // Map status
      status: updateData.status === 'Returned' ? 'Completed' : 
              updateData.status === 'Out' ? 'Out Now' : 
              updateData.status || borrowing.status
    };
    
    // If returning, set returnedAt
    if (updateData.status === 'Returned' && updateData.returnedTimestamp) {
      updatedFields.returnedAt = new Date(`${updateData.returnedTimestamp.date} ${updateData.returnedTimestamp.time}`);
      updatedFields.returnedTimestamp = updateData.returnedTimestamp;
    }
    
    // If undoing return, clear returnedAt
    if (updateData.status === 'Out' && updateData.returnedTimestamp === null) {
      updatedFields.returnedAt = null;
      updatedFields.returnedTimestamp = null;
    }
    
    // Update reference conditions if provided
    if (updateData.referenceConditions) {
      updatedFields.referenceConditions = updateData.referenceConditions;
    }
    
    const updatedBorrowing = await Borrowing.findByIdAndUpdate(
      id,
      updatedFields,
      { new: true, runValidators: true }
    );
    
    if (!updatedBorrowing) {
      return res.status(404).json({ message: 'Borrowing record not found' });
    }
    
    // Populate user info if available
    if (updatedBorrowing.borrowedBy) {
      await updatedBorrowing.populate('borrowedBy', 'fullname email');
    }
    
    res.json({
      id: updatedBorrowing._id,
      _id: updatedBorrowing._id,
      fullname: updatedBorrowing.Name || updatedBorrowing.fullname || '',
      contactNo: updatedBorrowing.contactNo || '',
      facebookAccount: updatedBorrowing.facebookAccount || '',
      equipment: updatedBorrowing.equipment || '',
      referenceIds: updatedBorrowing.referenceIds || [],
      referenceConditions: updatedBorrowing.referenceConditions || [],
      qty: updatedBorrowing.quantity || updatedBorrowing.qty || 1,
      borrowTimestamp: updatedBorrowing.borrowTimestamp || {
        date: updatedBorrowing.borrowDate ? updatedBorrowing.borrowDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        time: updatedBorrowing.borrowDate ? updatedBorrowing.borrowDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '09:00 AM'
      },
      endTime: updatedBorrowing.endTime || '',
      returnedTimestamp: updatedBorrowing.returnedTimestamp || (updatedBorrowing.returnedAt ? {
        date: updatedBorrowing.returnedAt.toISOString().split('T')[0],
        time: updatedBorrowing.returnedAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
      } : null),
      status: updatedBorrowing.status === 'Completed' ? 'Returned' : 
              updatedBorrowing.status === 'Out Now' ? 'Out' : 
              updatedBorrowing.status || 'Out',
      condition: updatedBorrowing.condition || null,
      borrowDate: updatedBorrowing.borrowDate,
      returnedAt: updatedBorrowing.returnedAt,
      message: 'Borrowing record updated successfully'
    });
  } catch (error) {
    console.error('Update borrowing error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Return item (update status to Completed)
// @route   PUT /api/borrowings/:id/return
// @access  Private/Admin
const returnBorrowedItem = async (req, res) => {
  try {
    const borrowing = await Borrowing.findById(req.params.id);
    
    if (!borrowing) {
      return res.status(404).json({ message: 'Borrowing record not found' });
    }
    
    if (borrowing.status === 'Completed' || borrowing.status === 'Returned') {
      return res.status(400).json({ message: 'Item already returned' });
    }
    
    // Update equipment stock if it exists
    const equipmentItem = await Equipment.findOne({ name: borrowing.equipment });
    if (equipmentItem) {
      equipmentItem.onLoan = Math.max(0, (equipmentItem.onLoan || 0) - (borrowing.quantity || borrowing.qty || 1));
      await equipmentItem.save();
    }
    
    const returnedTimestamp = {
      date: new Date().toISOString().split('T')[0],
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    };
    
    // Update borrowing record
    borrowing.status = 'Completed';
    borrowing.returnedAt = new Date();
    borrowing.returnedTimestamp = returnedTimestamp;
    await borrowing.save();
    
    res.status(200).json({
      id: borrowing._id,
      _id: borrowing._id,
      fullname: borrowing.Name || borrowing.fullname || '',
      contactNo: borrowing.contactNo || '',
      facebookAccount: borrowing.facebookAccount || '',
      equipment: borrowing.equipment,
      referenceIds: borrowing.referenceIds || [],
      referenceConditions: borrowing.referenceConditions || [],
      qty: borrowing.quantity || borrowing.qty || 1,
      borrowTimestamp: borrowing.borrowTimestamp || {
        date: borrowing.borrowDate ? borrowing.borrowDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        time: borrowing.borrowDate ? borrowing.borrowDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '09:00 AM'
      },
      endTime: borrowing.endTime || '',
      returnedTimestamp: returnedTimestamp,
      status: 'Returned',
      condition: borrowing.condition || null,
      returnedAt: borrowing.returnedAt,
      message: 'Item returned successfully'
    });
  } catch (error) {
    console.error('Return item error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Delete borrowing record
// @route   DELETE /api/borrowings/:id
// @access  Private/Admin
const deleteBorrowingRecord = async (req, res) => {
  try {
    const borrowing = await Borrowing.findById(req.params.id);
    
    if (!borrowing) {
      return res.status(404).json({ message: 'Borrowing record not found' });
    }
    
    // If item was out, update equipment stock
    if (borrowing.status === 'Out Now' || borrowing.status === 'Out') {
      const equipmentItem = await Equipment.findOne({ name: borrowing.equipment });
      if (equipmentItem) {
        equipmentItem.onLoan = Math.max(0, (equipmentItem.onLoan || 0) - (borrowing.quantity || borrowing.qty || 1));
        await equipmentItem.save();
      }
    }
    
    await Borrowing.findByIdAndDelete(req.params.id);
    
    res.status(200).json({ message: 'Borrowing record deleted successfully' });
  } catch (error) {
    console.error('Delete borrowing error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get borrowing record by ID
// @route   GET /api/borrowings/:id
// @access  Private/Admin
const getBorrowingById = async (req, res) => {
  try {
    const borrowing = await Borrowing.findById(req.params.id)
      .populate('borrowedBy', 'fullname email');
    
    if (!borrowing) {
      return res.status(404).json({ message: 'Borrowing record not found' });
    }
    
    res.status(200).json({
      id: borrowing._id,
      _id: borrowing._id,
      fullname: borrowing.Name || borrowing.fullname || '',
      contactNo: borrowing.contactNo || '',
      facebookAccount: borrowing.facebookAccount || '',
      equipment: borrowing.equipment || '',
      referenceIds: borrowing.referenceIds || [],
      referenceConditions: borrowing.referenceConditions || [],
      qty: borrowing.quantity || borrowing.qty || 1,
      borrowTimestamp: borrowing.borrowTimestamp || {
        date: borrowing.borrowDate ? borrowing.borrowDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        time: borrowing.borrowDate ? borrowing.borrowDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '09:00 AM'
      },
      endTime: borrowing.endTime || '',
      returnedTimestamp: borrowing.returnedTimestamp || (borrowing.returnedAt ? {
        date: borrowing.returnedAt.toISOString().split('T')[0],
        time: borrowing.returnedAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
      } : null),
      status: borrowing.status === 'Completed' ? 'Returned' : 
              borrowing.status === 'Out Now' ? 'Out' : 
              borrowing.status || 'Out',
      condition: borrowing.condition || null,
      borrowDate: borrowing.borrowDate,
      returnedAt: borrowing.returnedAt,
      borrowedBy: borrowing.borrowedBy
    });
  } catch (error) {
    console.error('Get borrowing by ID error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get borrowing statistics
// @route   GET /api/borrowings/stats
// @access  Private/Admin
const getBorrowingStats = async (req, res) => {
  try {
    const totalBorrowings = await Borrowing.countDocuments();
    const activeBorrowings = await Borrowing.countDocuments({ 
      $or: [{ status: 'Out Now' }, { status: 'Out' }] 
    });
    const completedBorrowings = await Borrowing.countDocuments({ 
      $or: [{ status: 'Completed' }, { status: 'Returned' }] 
    });
    const overdueBorrowings = await Borrowing.countDocuments({ status: 'Overdue' });
    
    const mostBorrowedEquipment = await Borrowing.aggregate([
      { $group: { _id: '$equipment', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]);
    
    res.status(200).json({
      totalBorrowings,
      activeBorrowings,
      completedBorrowings,
      overdueBorrowings,
      mostBorrowedEquipment
    });
  } catch (error) {
    console.error('Get borrowing stats error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get equipment with reference IDs
// @route   GET /api/equipment-with-refs
// @access  Private/Admin
const getEquipmentWithRefs = async (req, res) => {
  try {
    const equipment = await Equipment.find();
    
    // Transform equipment data into the required format
    const equipmentWithRefs = {};
    equipment.forEach(item => {
      if (item.name && item.referenceIds && Array.isArray(item.referenceIds)) {
        equipmentWithRefs[item.name] = item.referenceIds.map(ref => ({
          id: typeof ref === 'string' ? ref : (ref.id || ref),
          condition: ref.condition || 'Good'
        }));
      } else {
        // If equipment doesn't have reference IDs, generate some
        const refs = [];
        const total = item.quantity || 0;
        const prefix = item.name.substring(0, 3).toUpperCase();
        for (let i = 1; i <= total; i++) {
          refs.push({
            id: `${prefix}-${String(i).padStart(3, '0')}`,
            condition: 'Good'
          });
        }
        equipmentWithRefs[item.name] = refs;
      }
    });
    
    res.status(200).json(equipmentWithRefs);
  } catch (error) {
    console.error('Get equipment with refs error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = {
  getBorrowingRecords,
  createBorrowing,
  returnBorrowedItem,
  deleteBorrowingRecord,
  getBorrowingById,
  updateBorrowingRecord,
  getBorrowingStats,
  getEquipmentWithRefs
};