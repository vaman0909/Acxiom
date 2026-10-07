const http = require('http');

async function request(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch(e) {}
        resolve({ statusCode: res.statusCode, body: data, json });
      });
    });
    req.on('error', reject);
    if (postData) req.write(typeof postData === 'object' ? JSON.stringify(postData) : postData);
    req.end();
  });
}

async function testLockout() {
  console.log('--- TESTING ACCOUNT LOCKOUT POLICY (5 FAILED ATTEMPTS) ---');
  const targetEmail = 'john.sales@acxiom.com';

  // 1. Send 4 failed attempts
  for (let i = 1; i <= 4; i++) {
    const res = await request({
      hostname: 'localhost', port: 3000, path: '/auth/login', method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { email: targetEmail, password: 'WrongPassword@123' });

    console.log(`Attempt ${i}: Status ${res.statusCode}, Error: ${res.json?.error}`);
  }

  // 2. 5th failed attempt should trigger lockout (423)
  const res5 = await request({
    hostname: 'localhost', port: 3000, path: '/auth/login', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: targetEmail, password: 'WrongPassword@123' });

  console.log(`Attempt 5 (Lockout trigger): Status ${res5.statusCode}, Message: ${res5.json?.error}`);

  // 3. 6th attempt even with correct password while locked should be blocked (423)
  const res6 = await request({
    hostname: 'localhost', port: 3000, path: '/auth/login', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: targetEmail, password: 'Sales@12345' });

  console.log(`Attempt 6 (While locked): Status ${res6.statusCode}, Message: ${res6.json?.error}`);

  // 4. Admin unlocks the account
  const adminLogin = await request({
    hostname: 'localhost', port: 3000, path: '/auth/login', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: 'admin@acxiom.com', password: 'Admin@12345' });

  // Get john's user id
  const targetUser = require('./db').prepare('SELECT UserId FROM Users WHERE Email = ?').get(targetEmail);
  const unlockRes = await request({
    hostname: 'localhost', port: 3000, path: `/users-data/${targetUser.UserId}/unlock`, method: 'POST',
    headers: { 'Authorization': `Bearer ${adminLogin.json.token}` }
  });
  console.log(`Admin Unlock: Status ${unlockRes.statusCode}, Message: ${unlockRes.json?.message}`);

  // 5. Login again with correct password after unlock
  const resSuccess = await request({
    hostname: 'localhost', port: 3000, path: '/auth/login', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: targetEmail, password: 'Sales@12345' });
  console.log(`Login After Unlock: Status ${resSuccess.statusCode}, Success: ${resSuccess.json?.success}`);

  console.log('--- ACCOUNT LOCKOUT TEST COMPLETE ---');
}

testLockout();
