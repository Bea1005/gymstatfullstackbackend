// Test API response structure
const dns = require('dns');
const mongoose = require('mongoose');
require('dotenv').config();

(async () => {
  try {
    // Setup DNS
    const dnsServers = process.env.MONGO_DNS_SERVERS 
      ? process.env.MONGO_DNS_SERVERS.split(',').map(v => v.trim()).filter(Boolean)
      : [];
    
    if (dnsServers.length > 0) {
      dns.setServers(dnsServers);
    }
    
    // Connect to MongoDB
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 60000
    });
    
    console.log('✅ Connected to MongoDB');
    
    // Load Borrowing model
    const Borrowing = require('./src/models/Borrowing');
    
    // Get borrowings like the API does
    const borrowings = await Borrowing.find()
      .populate('borrowedBy', 'fullname email')
      .sort({ borrowDate: -1 });
    
    console.log('📊 Total borrowing records:', borrowings.length);
    
    if (borrowings.length > 0) {
      console.log('\n🔍 Sample record (raw Mongoose document):');
      const record = borrowings[0].toObject();
      console.log(JSON.stringify(record, null, 2));
      
      console.log('\n✅ Fields verification:');
      console.log('  - contactNo:', record.contactNo !== undefined ? '✓ ' + record.contactNo : '✗ undefined');
      console.log('  - facebookAccount:', record.facebookAccount !== undefined ? '✓ ' + record.facebookAccount : '✗ undefined');
      console.log('  - borrowTimestamp:', record.borrowTimestamp ? '✓ ' + JSON.stringify(record.borrowTimestamp) : '✗ undefined');
      console.log('  - endTime:', record.endTime !== undefined ? '✓ ' + record.endTime : '✗ undefined');
    }
    
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
})();
