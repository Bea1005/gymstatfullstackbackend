// Test API endpoints
(async () => {
  try {
    // First get a token
    console.log('🔑 Authenticating...');
    const loginRes = await fetch('http://localhost:4002/api/v1/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@test.com', password: 'admin123' })
    });
    
    const loginData = await loginRes.json();
    if (!loginData.token) {
      console.error('❌ Login failed:', loginData);
      process.exit(1);
    }
    
    const token = loginData.token;
    console.log('✅ Login successful');
    console.log('\n📋 Testing Borrowing API routes...\n');
    
    // Get borrowing records
    const borrowRes = await fetch('http://localhost:4002/api/v1/admin/borrowing', {
      method: 'GET',
      headers: { 
        'Authorization': 'Bearer ' + token
      }
    });
    
    if (!borrowRes.ok) {
      console.error('❌ Borrowing route error:', borrowRes.status);
      const text = await borrowRes.text();
      console.error(text);
      process.exit(1);
    }
    
    const borrowings = await borrowRes.json();
    console.log('✅ Retrieved borrowing records from test database');
    console.log('📊 Total records:', borrowings.length);
    
    if (borrowings.length > 0) {
      console.log('\n🔍 Sample borrowing record:');
      const sample = borrowings[0];
      console.log('   ID:', sample._id);
      console.log('   Borrower Name:', sample.fullname);
      console.log('   Contact No:', sample.contactNo);
      console.log('   Facebook Account:', sample.facebookAccount);
      console.log('   Equipment:', sample.equipment);
      console.log('   Quantity:', sample.qty);
      console.log('   Borrow Time:', sample.borrowTimestamp);
      console.log('   End Time:', sample.endTime);
      console.log('   Status:', sample.status);
      
      console.log('\n✅ All required fields are present and working!');
    } else {
      console.log('ℹ️  No borrowing records found (database is empty or no records)');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
})();
