// Test borrowing records without populate
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
    console.log('📁 Database:', conn.connection.name);
    
    // Direct collection access
    const borrowingsCollection = conn.connection.db.collection('borrowings');
    
    const borrowings = await borrowingsCollection
      .find({})
      .sort({ borrowDate: -1 })
      .toArray();
    
    console.log('\n📊 Total borrowing records:', borrowings.length);
    
    if (borrowings.length > 0) {
      console.log('\n🔍 Sample record:');
      const record = borrowings[0];
      
      console.log('\n📋 Complete Record Structure:');
      console.log(JSON.stringify(record, null, 2));
      
      console.log('\n✅ Required Fields Verification:');
      const requiredFields = ['contactNo', 'facebookAccount', 'endTime'];
      requiredFields.forEach(field => {
        const value = record[field];
        const status = value !== undefined && value !== null && value !== '' ? '✓' : '(empty)';
        console.log(`  - ${field}: ${status}`);
      });
      
      console.log('\n✅ Timestamp Fields:');
      console.log(`  - borrowTimestamp: ${record.borrowTimestamp ? JSON.stringify(record.borrowTimestamp) : '(empty)'}`);
      console.log(`  - endTime: ${record.endTime || '(empty)'}`);
    }
    
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
})();
