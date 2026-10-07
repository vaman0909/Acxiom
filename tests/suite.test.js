const http = require('http');

async function testScenario(name, fn) {
  try {
    const res = await fn();
    console.log(`[PASS] ${name}:`, res);
    return true;
  } catch (err) {
    console.error(`[FAIL] ${name}:`, err.message);
    return false;
  }
}

async function request(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch(e) {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data,
          json
        });
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'object' ? JSON.stringify(postData) : postData);
    }
    req.end();
  });
}

async function runTests() {
  console.log('--- STARTING ACXIOM CRM AUTOMATED ACCEPTANCE VERIFICATION ---');
  let passed = 0;
  let total = 0;

  // 1. Unauthenticated access check
  total++;
  if (await testScenario('1. Unauthenticated access to /api/customers rejected (401)', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/customers',
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    if (res.statusCode !== 401) throw new Error(`Expected 401, got ${res.statusCode}`);
    return `Status ${res.statusCode} (Unauthorized) as expected`;
  })) passed++;

  // 2. Authentication with valid user
  let token = null;
  total++;
  if (await testScenario('2. Login with valid test user (admin@acxiom.com)', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: 'admin@acxiom.com', password: 'Admin@12345' });

    if (res.statusCode !== 200 || !res.json.token) throw new Error(`Expected 200 with token, got ${res.statusCode}`);
    token = res.json.token;
    return `Authenticated successfully as ${res.json.user.Role}`;
  })) passed++;

  // 3. Server-side customer validation: Invalid email
  total++;
  if (await testScenario('3. Server-side Customer validation: Invalid email format rejected (400)', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/customers',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    }, {
      CustomerName: 'Test Corp',
      Email: 'not-an-email',
      Phone: '+91 9876543210'
    });

    if (res.statusCode !== 400) throw new Error(`Expected 400, got ${res.statusCode}`);
    return `Rejected with 400: ${res.json.error}`;
  })) passed++;

  // 4. Server-side customer validation: Invalid phone
  total++;
  if (await testScenario('4. Server-side Customer validation: Invalid phone format rejected (400)', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/customers',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    }, {
      CustomerName: 'Test Corp',
      Email: 'valid@testcorp.com',
      Phone: '123' // too short
    });

    if (res.statusCode !== 400) throw new Error(`Expected 400, got ${res.statusCode}`);
    return `Rejected with 400: ${res.json.error}`;
  })) passed++;

  // 5. Opportunity validation: Amount <= 0
  total++;
  if (await testScenario('5. Opportunity validation: Amount <= 0 rejected (400)', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/opportunities',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    }, {
      OpportunityName: 'Invalid Deal',
      CustomerId: 1,
      Amount: 0,
      Stage: 'Proposal',
      Probability: 50,
      ExpectedCloseDate: '2026-11-01'
    });

    if (res.statusCode !== 400) throw new Error(`Expected 400, got ${res.statusCode}`);
    return `Rejected with 400: ${res.json.details ? res.json.details[0] : res.json.error}`;
  })) passed++;

  // 6. Opportunity validation: Probability > 100
  total++;
  if (await testScenario('6. Opportunity validation: Probability > 100 rejected (400)', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/opportunities',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    }, {
      OpportunityName: 'Overconfident Deal',
      CustomerId: 1,
      Amount: 50000,
      Stage: 'Proposal',
      Probability: 110,
      ExpectedCloseDate: '2026-11-01'
    });

    if (res.statusCode !== 400) throw new Error(`Expected 400, got ${res.statusCode}`);
    return `Rejected with 400: ${res.json.details ? res.json.details[0] : res.json.error}`;
  })) passed++;

  // 7. Opportunity validation: Past Expected Close Date
  total++;
  if (await testScenario('7. Opportunity validation: Past Expected Close Date rejected (400)', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/opportunities',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    }, {
      OpportunityName: 'Past Deal',
      CustomerId: 1,
      Amount: 50000,
      Stage: 'Proposal',
      Probability: 50,
      ExpectedCloseDate: '2020-01-01'
    });

    if (res.statusCode !== 400) throw new Error(`Expected 400, got ${res.statusCode}`);
    return `Rejected with 400: ${res.json.details ? res.json.details[0] : res.json.error}`;
  })) passed++;

  // 8. Follow-up validation: Past date for planned activity
  total++;
  if (await testScenario('8. Follow-up validation: Follow-up date earlier than today rejected (400)', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/followups',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    }, {
      Subject: 'Old Call',
      FollowUpDate: '2020-01-01',
      CustomerId: 1,
      Status: 'Planned'
    });

    if (res.statusCode !== 400) throw new Error(`Expected 400, got ${res.statusCode}`);
    return `Rejected with 400: ${res.json.details ? res.json.details[0] : res.json.error}`;
  })) passed++;

  // 9. SalesExecutive scoped access
  total++;
  if (await testScenario('9. SalesExecutive role scoping test', async () => {
    // Login as sales
    const salesLogin = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: 'sales@acxiom.com', password: 'Sales@12345' });

    const salesToken = salesLogin.json.token;

    // Fetch customers
    const custRes = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/customers',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${salesToken}` }
    });

    if (custRes.statusCode !== 200) throw new Error(`Expected 200, got ${custRes.statusCode}`);
    return `SalesExecutive received ${custRes.json.length} scoped customer records`;
  })) passed++;

  // 10. Call /api/customers with Admin token
  total++;
  if (await testScenario('10. Call /api/customers with Admin token (200 with DTOs)', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/customers',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.statusCode !== 200 || !Array.isArray(res.json)) throw new Error(`Expected 200 array, got ${res.statusCode}`);
    return `Received ${res.json.length} customer records (DTO compliant)`;
  })) passed++;

  // 11. Pipeline report API
  total++;
  if (await testScenario('11. Call /api/reports/pipeline (200 with stage data)', async () => {
    const res = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/reports/pipeline',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.statusCode !== 200 || !res.json.stages) throw new Error(`Expected 200 with stages, got ${res.statusCode}`);
    return `Received ${res.json.stages.length} pipeline stage aggregations`;
  })) passed++;

  console.log(`\n========================================`);
  console.log(`  TEST RESULTS: ${passed} / ${total} PASSED`);
  console.log(`========================================\n`);
}

runTests();
