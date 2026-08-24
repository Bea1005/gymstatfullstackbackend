const mongoose = require('mongoose');

const borrowingSchema = new mongoose.Schema({
  Name: {
    type: String,
    required: true,
    trim: true
  },
  fullname: {
    type: String,
    trim: true,
    default: ''
  },
  contactNo: {
    type: String,
    trim: true,
    default: ''
  },
  facebookAccount: {
    type: String,
    trim: true,
    default: ''
  },
  equipment: {
    type: String,
    required: true,
    trim: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  qty: {
    type: Number,
    default: 0,
    min: 0
  },
  referenceIds: {
    type: [String],
    default: []
  },
  referenceConditions: {
    type: [String],
    default: []
  },
  borrowDate: {
    type: Date,
    default: Date.now
  },
  returnDate: {
    type: Date,
    default: null
  },
  status: {
    type: String,
    enum: ['Out Now', 'Completed', 'Overdue', 'Out', 'Returned'],
    default: 'Out Now'
  },
  condition: {
    type: String,
    enum: ['Good', 'Damaged', 'Lost', 'Under Repair', null],
    default: null
  },
  borrowTimestamp: {
    date: {
      type: String,
      default: ''
    },
    time: {
      type: String,
      default: ''
    }
  },
  endTime: {
    type: String,
    default: ''
  },
  returnedAt: {
    type: Date,
    default: null
  },
  returnedTimestamp: {
    date: {
      type: String,
      default: ''
    },
    time: {
      type: String,
      default: ''
    }
  },
  borrowedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Borrowing', borrowingSchema);