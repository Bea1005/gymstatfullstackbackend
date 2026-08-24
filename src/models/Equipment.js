const mongoose = require('mongoose');

const EquipmentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  type: {
    type: String,
    enum: ['Balls', 'Rackets', 'Net', 'General', 'Sports Equipment'],
    default: 'Sports Equipment'
  },
  referenceId: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  category: {
    type: String,
    enum: ['Balls', 'Rackets', 'Net', 'General', 'Sports Equipment'],
    default: 'Sports Equipment'
  },
  totalStock: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  onLoan: {
    type: Number,
    default: 0,
    min: 0
  },
  available: {
    type: Number,
    default: 0
  },
  condition: {
    type: String,
    enum: ['Good', 'Fair', 'Poor'],
    default: 'Good'
  },
  status: {
    type: String,
    enum: ['Available', 'Low Stock', 'Out of Stock'],
    default: 'Available'
  }
}, {
  timestamps: true,
  collection: 'equipments'
});

// Update available count and status before saving
EquipmentSchema.pre('save', function(next) {
  this.available = this.totalStock - this.onLoan;
  if (this.available <= 0) {
    this.status = 'Out of Stock';
  } else if (this.available < 5) {
    this.status = 'Low Stock';
  } else {
    this.status = 'Available';
  }
  next();
});

// Create indexes for better performance
EquipmentSchema.index({ name: 1 });
EquipmentSchema.index({ referenceId: 1 });

module.exports = mongoose.model('Equipment', EquipmentSchema, 'equipments');