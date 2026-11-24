const mongoose = require('mongoose');

const ScreenerIdSequenceSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true
  },
  value: {
    type: Number,
    required: true,
    min: 0,
    max: 0xFFFF
  }
}, {
  versionKey: false,
  collection: 'screener_id_sequences'
});

module.exports = mongoose.model('ScreenerIdSequence', ScreenerIdSequenceSchema);
