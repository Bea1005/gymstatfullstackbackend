const mongoose = require('mongoose');

const AdminSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true
  },
  fullname: {
    type: String,
    required: true
  },
  username: {
    type: String,
    required: true
  },
  email: {
    type: String,
    default: ''
  },
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    default: 'admin'
  },
  status: {
    type: String,
    default: 'Inactive'
  },
  lastActiveAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Admin', AdminSchema, 'admins');
