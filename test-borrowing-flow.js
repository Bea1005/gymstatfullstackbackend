// Test complete borrowing data flow
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
    
    // Access Borrowings collection
    const borrowingsCollection = conn.connection.db.collection('borrowings');
    
    console.log('\n🔍 Checking current borrowing records...');
    const allBorrowings = await borrowingsCollection.find({}).toArray();
    console.log('📊 Total borrowing records:', allBorrowings.length);
    
    // Check if new fields exist
    if (allBorrowings.length > 0) {
      console.log('\n📋 Verifying data structure with sample records:\n');
      
      allBorrowings.forEach((record, index) => {
        console.log(`Record ${index + 1}:`);
        console.log('  - Name:', record.Name || record.fullname);
        console.log('  - Equipment:', record.equipment);
        console.log('  - Contact No:', record.contactNo || '(empty)');
        console.log('  - Facebook Account:', record.facebookAccount || '(empty)');
        console.log('  - Borrow Timestamp:', record.borrowTimestamp);
        console.log('  - End Time:', record.endTime || '(empty)');
        console.log('  - Status:', record.status);
        console.log('');
      });
      
      // Check schema fields
      const sampleRecord = allBorrowings[0];
      const hasContactNo = 'contactNo' in sampleRecord;
      const hasFacebookAccount = 'facebookAccount' in sampleRecord;
      const hasBorrowTimestamp = 'borrowTimestamp' in sampleRecord;
      const hasEndTime = 'endTime' in sampleRecord;
      
      console.log('✅ Schema Field Verification:');
      console.log('  - contactNo:', hasContactNo ? '✓ Present' : '✗ Missing');
      console.log('  - facebookAccount:', hasFacebookAccount ? '✓ Present' : '✗ Missing');
      console.log('  - borrowTimestamp:', hasBorrowTimestamp ? '✓ Present' : '✗ Missing');
      console.log('  - endTime:', hasEndTime ? '✓ Present' : '✗ Missing');
      
    } else {
      console.log('ℹ️  No borrowing records found in database');
    }
    
    // Check MongoDB collections
    console.log('\n📚 Collections in test database:');
    const collections = await conn.connection.db.listCollections().toArray();
    collections.forEach(col => console.log('   -', col.name));
    
    await mongoose.disconnect();
    console.log('\n✅ Test completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
})();
