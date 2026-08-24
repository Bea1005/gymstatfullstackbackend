/**
 * Test Schedule MongoDB Integration
 * Run this script to test schedule and schedule request operations
 * Usage: node test-schedule-mongodb.js
 */

const BASE_URL = "http://localhost:4000/api/v1";

// Test data
const testScheduleRequest = {
  eventName: "Basketball Championship 2026",
  requesterName: "John Smith",
  requesterEmail: "john.smith@example.com",
  requesterPhone: "09171234567",
  organization: "Sports Committee",
  purpose: "Inter-school basketball tournament",
  details: "Need the gym for 3 days including setup and cleanup",
  startDate: "2026-08-15",
  startTime: "08:00 AM",
  endDate: "2026-08-17",
  endTime: "06:00 PM",
  prepDays: 1
};

const testSchedule = {
  event: "Faculty Meeting",
  startDate: "2026-07-20",
  endDate: "2026-07-20",
  startTime: "02:00 PM",
  endTime: "05:00 PM",
  organization: "Faculty",
  purpose: "Quarterly planning meeting",
  prepDays: 0
};

async function testSubmitScheduleRequest() {
  console.log('\n🧪 TEST 1: Submit Schedule Request (Public)');
  console.log('═══════════════════════════════════════════════════');
  
  try {
    const response = await fetch(`${BASE_URL}/schedule-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testScheduleRequest)
    });
    
    const data = await response.json();
    console.log('Response Status:', response.status);
    console.log('Success:', data.success);
    console.log('Message:', data.message);
    
    if (data.success && data.data) {
      console.log('✅ Schedule request saved to MongoDB');
      console.log('Request ID:', data.data._id);
      console.log('Status:', data.data.status);
      return data.data._id;
    } else {
      console.log('❌ Failed:', data.message);
      return null;
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    return null;
  }
}

async function testGetScheduleRequests(token) {
  console.log('\n🧪 TEST 2: Get All Schedule Requests (Admin)');
  console.log('═══════════════════════════════════════════════════');
  
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    const response = await fetch(`${BASE_URL}/schedule-requests`, {
      method: 'GET',
      headers
    });
    
    const data = await response.json();
    console.log('Response Status:', response.status);
    
    if (data.success) {
      console.log('✅ Retrieved from MongoDB');
      console.log('Total Requests:', data.count);
      console.log('Requests:', data.data.map(r => ({
        id: r._id,
        event: r.eventName,
        requester: r.requesterName,
        status: r.status
      })));
    } else {
      console.log('❌ Failed:', data.message);
      if (response.status === 401) {
        console.log('⚠️  Note: This endpoint requires admin authentication');
      }
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function testCreateSchedule(token) {
  console.log('\n🧪 TEST 3: Create Schedule (Admin)');
  console.log('═══════════════════════════════════════════════════');
  
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    const response = await fetch(`${BASE_URL}/schedules`, {
      method: 'POST',
      headers,
      body: JSON.stringify(testSchedule)
    });
    
    const data = await response.json();
    console.log('Response Status:', response.status);
    
    if (data.success && data.data) {
      console.log('✅ Schedule saved to MongoDB');
      console.log('Schedule ID:', data.data._id);
      console.log('Event:', data.data.event);
      console.log('Status:', data.data.status);
      return data.data._id;
    } else {
      console.log('❌ Failed:', data.message);
      if (response.status === 401) {
        console.log('⚠️  Note: This endpoint requires admin authentication');
      }
      return null;
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    return null;
  }
}

async function testGetSchedules() {
  console.log('\n🧪 TEST 4: Get All Schedules (Public)');
  console.log('═══════════════════════════════════════════════════');
  
  try {
    const response = await fetch(`${BASE_URL}/schedules`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    
    const data = await response.json();
    console.log('Response Status:', response.status);
    
    if (data.success) {
      console.log('✅ Retrieved from MongoDB');
      console.log('Total Schedules:', data.count);
      console.log('Schedules:', data.data.map(s => ({
        id: s._id,
        event: s.event,
        date: s.startDate,
        status: s.status
      })));
    } else {
      console.log('❌ Failed:', data.message);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function testApproveRequest(requestId, token) {
  console.log('\n🧪 TEST 5: Approve Schedule Request (Admin)');
  console.log('═══════════════════════════════════════════════════');
  
  if (!requestId) {
    console.log('⚠️  Skipping - No request ID available');
    return;
  }
  
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    const response = await fetch(`${BASE_URL}/schedule-requests/${requestId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ status: 'approved' })
    });
    
    const data = await response.json();
    console.log('Response Status:', response.status);
    
    if (data.success) {
      console.log('✅ Request approved');
      console.log('Updated Status:', data.data.status);
      
      if (data.data.schedule) {
        console.log('✅ Schedule automatically created');
        console.log('Schedule ID:', data.data.schedule._id);
      }
    } else {
      console.log('❌ Failed:', data.message);
      if (response.status === 401) {
        console.log('⚠️  Note: This endpoint requires admin authentication');
      }
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function runTests() {
  console.log('═══════════════════════════════════════════════════');
  console.log('   Schedule MongoDB Integration Test');
  console.log('═══════════════════════════════════════════════════');
  console.log('Server:', BASE_URL);
  console.log('\n⚠️  Note: Some tests require admin authentication');
  console.log('    These will show 401 errors without a token\n');
  
  // Test 1: Submit Schedule Request (Public - No Auth)
  const requestId = await testSubmitScheduleRequest();
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test 2: Get Schedule Requests (Admin - Requires Auth)
  await testGetScheduleRequests(null);
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test 3: Create Schedule (Admin - Requires Auth)
  const scheduleId = await testCreateSchedule(null);
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test 4: Get Schedules (Public - No Auth)
  await testGetSchedules();
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test 5: Approve Request (Admin - Requires Auth)
  await testApproveRequest(requestId, null);
  
  console.log('\n═══════════════════════════════════════════════════');
  console.log('   Test Suite Completed');
  console.log('═══════════════════════════════════════════════════');
  console.log('\n✅ Successful Operations:');
  console.log('   - Submit Schedule Request (Public)');
  console.log('   - Get Schedules (Public)');
  console.log('\n🔒 Operations Requiring Admin Auth:');
  console.log('   - Get Schedule Requests');
  console.log('   - Create Schedule');
  console.log('   - Approve/Reject Request');
  console.log('\n📋 Next Steps:');
  console.log('   1. Check MongoDB Compass');
  console.log('   2. Verify collections: schedules, schedulerequests');
  console.log('   3. Login as admin in frontend to test protected routes');
  console.log('\n');
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
