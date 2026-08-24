/**
 * Test Authentication System
 * Run this script to test registration and login
 * Usage: node test-auth.js
 */

const testUser = {
  fullname: "Test User",
  username: "testuser" + Date.now(),
  id: "TEST" + Date.now(),
  password: "password123",
  role: "student",
  email: "test@example.com"
};

const BASE_URL = "http://localhost:4000/api/v1";

async function testRegistration() {
  console.log('\n🧪 Testing Registration...');
  console.log('Test User:', { ...testUser, password: '***' });
  
  try {
    const response = await fetch(`${BASE_URL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testUser)
    });
    
    const data = await response.json();
    console.log('Response Status:', response.status);
    console.log('Response:', JSON.stringify(data, null, 2));
    
    if (data.success) {
      console.log('✅ Registration successful!');
      return true;
    } else {
      console.log('❌ Registration failed:', data.message);
      return false;
    }
  } catch (error) {
    console.error('❌ Registration error:', error.message);
    return false;
  }
}

async function testLogin() {
  console.log('\n🧪 Testing Login...');
  console.log('Login with ID:', testUser.id);
  
  try {
    const response = await fetch(`${BASE_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: testUser.id,
        password: testUser.password
      })
    });
    
    const data = await response.json();
    console.log('Response Status:', response.status);
    console.log('Response:', JSON.stringify(data, null, 2));
    
    if (data.success && data.token) {
      console.log('✅ Login successful!');
      console.log('✅ Token received:', data.token.substring(0, 20) + '...');
      return data.token;
    } else {
      console.log('❌ Login failed:', data.message);
      return null;
    }
  } catch (error) {
    console.error('❌ Login error:', error.message);
    return null;
  }
}

async function testProtectedRoute(token) {
  console.log('\n🧪 Testing Protected Route...');
  
  try {
    const response = await fetch(`${BASE_URL}/admin/users`, {
      method: 'GET',
      headers: { 
        'Authorization': `Bearer ${token}`
      }
    });
    
    const data = await response.json();
    console.log('Response Status:', response.status);
    console.log('Response:', JSON.stringify(data, null, 2));
    
    if (response.status === 403) {
      console.log('✅ Authorization working - Student role cannot access admin route');
      return true;
    } else if (data.success) {
      console.log('✅ Protected route accessible');
      return true;
    } else {
      console.log('❌ Protected route failed:', data.message);
      return false;
    }
  } catch (error) {
    console.error('❌ Protected route error:', error.message);
    return false;
  }
}

async function runTests() {
  console.log('═══════════════════════════════════════════════════');
  console.log('   GymStat Authentication System Test');
  console.log('═══════════════════════════════════════════════════');
  console.log('Server:', BASE_URL);
  
  // Test 1: Registration
  const registrationSuccess = await testRegistration();
  if (!registrationSuccess) {
    console.log('\n❌ Tests failed at registration step');
    return;
  }
  
  // Wait a bit for database to be ready
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test 2: Login
  const token = await testLogin();
  if (!token) {
    console.log('\n❌ Tests failed at login step');
    return;
  }
  
  // Test 3: Protected Route
  await testProtectedRoute(token);
  
  console.log('\n═══════════════════════════════════════════════════');
  console.log('   Test Suite Completed');
  console.log('═══════════════════════════════════════════════════\n');
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
