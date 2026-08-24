const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
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
} = require('../controllers/equipmentController');

// All routes require authentication; apply admin-only guard only to /admin sub-path
router.use(protect);
router.use('/admin', authorize('admin'));

// Equipment management
router.get('/admin/equipment', getEquipment);
router.post('/admin/equipment', createEquipment);
router.get('/admin/equipment/options', getEquipmentOptions);
router.get('/admin/equipment/stats', getEquipmentStats);
router.get('/admin/equipment/low-stock', getLowStockEquipment);
router.get('/admin/equipment/out-of-stock', getOutOfStockEquipment);
router.get('/admin/equipment/categories', getEquipmentCategories);
router.get('/admin/equipment/:id', getEquipmentById);
router.put('/admin/equipment/:id', updateEquipment);
router.delete('/admin/equipment/:id', deleteEquipment);

// Borrowing actions
router.put('/admin/equipment/:id/borrow', borrowEquipment);
router.put('/admin/equipment/:id/return', returnEquipment);

module.exports = router;