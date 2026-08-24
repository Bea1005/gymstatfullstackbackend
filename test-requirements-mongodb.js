/**
 * Test Requirements MongoDB Integration
 * Run this script to test requirement operations
 * Usage: node test-requirements-mongodb.js
 * 
 * Note: Some tests require admin authentication token
 */

const BASE_URL = "http://localhost:4000/api/v1";

// Test data
const testRequirement = {
  title: "Medical Certificate Submission",
  description: "Submit your annual medical certificate for sports participation",
  type: "medical",
  sport: "General",
  dueDate: "2026-12-31",
  priority: "high",
  instructions: "Download the template, get it filled by your doctor, and upload the completed form",
  targetStudents: "all"
};

async function testCreateRequirement(token) {
  console.log('\n🧪 TEST 1: Create Requirement (Admin)');
  console.log('═══════════════════════════════════════════════════');
  
  if (!token) {
    console.log('⚠️  Skipping - Requires admin authentication token');
    console.log('💡 Login as admin and provide token to test this');
    return null;
  }
  
  try {
    const response = await fetch(`${BASE_URL}/requirements`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(testRequirement)
    });
    
    const data = await response.json();
    console.log('Response Status:', response.status);
    
    if (data.success && data.data) {
      console.log('✅ Requirement created in MongoDB');
      console.log('Requirement ID:', data.data._id);
      console.log('Title:', data.data.title);
      console.log('Status:', data.data.status, '(initially draft)');
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

async function testPublishRequirement(requirementId, token) {
  console.log('\n🧪 TEST 2: Publish Requirement (Admin)');
  console.log('═══════════════════════════════════════════════════');
  
  if (!requirementId) {
    console.log('⚠️  Skipping - No requirement ID available');
    return;
  }
  
  if (!token) {
    console.log('⚠️  Skipping - Requires admin authentication token');
    return;
  }
  
  try {
    const response = await fetch(`${BASE_URL}/requirements/${requirementId}/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    
    const data = await response.json();
    console.log('Response Status:', response.status);
    
    if (data.success) {
      console.log('✅ Requirement published');
      console.log('Status:', data.data.status);
      console.log('Published At:', data.data.publishedAt);
      console.log('✅ Announcement created for notification system');
      console.log('✅ Now visible to students');
    } else {
      console.log('❌ Failed:', data.message);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function testGetPublishedRequirements(studentToken) {
  console.log('\n🧪 TEST 3: Get Published Requirements (Student)');
  console.log('═══════════════════════════════════════════════════');
  
  if (!studentToken) {
    console.log('⚠️  Skipping - Requires student authentication token');
    console.log('💡 Login as student and provide token to test this');
    return;
  }
  
  try {
    const response = await fetch(`${BASE_URL}/requirements/published`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${studentToken}`
      }
    });
    
    const data = await response.json();
    console.log('Response Status:', response.status);
    
    if (data.success) {
      console.log('✅ Retrieved from MongoDB');
      console.log('Total Requirements:', data.count);
      console.log('Requirements:', data.data.map(r => ({
        id: r._id,
        title: r.title,
        type: r.type,
        dueDate: r.dueDate,
        status: r.submissionStatus || 'not-submitted'
      })));
    } else {
      console.log('❌ Failed:', data.message);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function testSubmitRequirement(requirementId, studentToken) {
  console.log('\n🧪 TEST 4: Submit Requirement (Student)');
  console.log('═══════════════════════════════════════════════════');
  
  if (!requirementId) {
    console.log('⚠️  Skipping - No requirement ID available');
    return;
  }
  
  if (!studentToken) {
    console.log('⚠️  Skipping - Requires student authentication token');
    return;
  }
  
  try {
    const submissionData = {
      file: {
        filename: 'medical_cert.pdf',
        originalname: 'My Medical Certificate.pdf',
        mimetype: 'application/pdf',
        size: 150000
      },
      remarks: 'Completed medical checkup on July 15, 2026'
    };
    
    const response = await fetch(`${BASE_URL}/requirements/${requirementId}/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${studentToken}`
      },
      body: JSON.stringify(submissionData)
    });
    
    const data = await response.json();
    console.log('Response Status:', response.status);
    
    if (data.success && data.data) {
      console.log('✅ Submission saved to MongoDB');
      console.log('Submission ID:', data.data._id);
      console.log('Status:', data.data.status);
      console.log('Is Late:', data.data.isLate);
      console.log('Submitted At:', data.data.submittedAt);
    } else {
      console.log('❌ Failed:', data.message);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function testGetMySubmissions(studentToken) {
  console.log('\n🧪 TEST 5: Get My Submissions (Student)');
  console.log('═══════════════════════════════════════════════════');
  
  if (!studentToken) {
    console.log('⚠️  Skipping - Requires student authentication token');
    return;
  }
  
  try {
    const response = await fetch(`${BASE_URL}/requirements/my/submissions`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${studentToken}`
      }
    });
    
    const data = await response.json();
    console.log('Response Status:', response.status);
    
    if (data.success) {
      console.log('✅ Retrieved from MongoDB');
      console.log('Total Submissions:', data.count);
      console.log('Submissions:', data.data.map(s => ({
        id: s._id,
        requirement: s.requirementId?.title || 'N/A',
        status: s.status,
        submittedAt: s.submittedAt
      })));
    } else {
      console.log('❌ Failed:', data.message);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function testGetAllSubmissions(adminToken) {
  console.log('\n🧪 TEST 6: Get All Submissions (Admin)');
  console.log('═══════════════════════════════════════════════════');
  
  if (!adminToken) {
    console.log('⚠️  Skipping - Requires admin authentication token');
    return;
  }
  
  try {
    const response = await fetch(`${BASE_URL}/requirements/admin/submissions`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      }
    });
    
    const data = await response.json();
    console.log('Response Status:', response.status);
    
    if (data.success) {
      console.log('✅ Retrieved from MongoDB');
      console.log('Total Submissions:', data.count);
      console.log('Submissions:', data.data.map(s => ({
        id: s._id,
        student: s.studentId?.fullname || 'N/A',
        requirement: s.requirementId?.title || 'N/A',
        status: s.status
      })));
    } else {
      console.log('❌ Failed:', data.message);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function runTests() {
  console.log('═══════════════════════════════════════════════════');
  console.log('   Requirements MongoDB Integration Test');
  console.log('═══════════════════════════════════════════════════');
  console.log('Server:', BASE_URL);
  console.log('\n⚠️  Note: Tests require authentication tokens');
  console.log('    Admin token for admin operations');
  console.log('    Student token for student operations\n');
  
  // For actual testing, you would provide real tokens here
  const adminToken = null;  // Replace with real admin token
  const studentToken = null; // Replace with real student token
  
  // Test 1: Create Requirement
  const requirementId = await testCreateRequirement(adminToken);
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test 2: Publish Requirement
  await testPublishRequirement(requirementId, adminToken);
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test 3: Get Published Requirements (Student View)
  await testGetPublishedRequirements(studentToken);
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test 4: Submit Requirement
  await testSubmitRequirement(requirementId, studentToken);
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test 5: Get My Submissions
  await testGetMySubmissions(studentToken);
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test 6: Get All Submissions (Admin View)
  await testGetAllSubmissions(adminToken);
  
  console.log('\n═══════════════════════════════════════════════════');
  console.log('   Test Suite Completed');
  console.log('═══════════════════════════════════════════════════');
  console.log('\n📋 Next Steps:');
  console.log('   1. Login as admin in the frontend');
  console.log('   2. Create and publish a requirement');
  console.log('   3. Check MongoDB Compass:');
  console.log('      - requirements collection');
  console.log('      - announcements collection');
  console.log('   4. Login as student');
  console.log('   5. Check notification bell (should show new requirement)');
  console.log('   6. Submit the requirement');
  console.log('   7. Check requirementsubmissions collection\n');
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
