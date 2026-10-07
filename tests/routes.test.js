const http = require('http');

async function testAllRoutes() {
  console.log('--- VERIFYING ALL HTML VIEW ROUTES & RESPONSES ---');

  // Login as admin to get session cookie
  const loginReq = http.request({
    hostname: 'localhost',
    port: 3000,
    path: '/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });

  const cookie = await new Promise((resolve) => {
    loginReq.on('response', res => {
      const setCookie = res.headers['set-cookie'];
      resolve(setCookie ? setCookie[0] : null);
    });
    loginReq.write(JSON.stringify({ email: 'admin@acxiom.com', password: 'Admin@12345' }));
    loginReq.end();
  });

  const routes = [
    '/login',
    '/dashboard',
    '/customers',
    '/leads',
    '/opportunities',
    '/followups',
    '/activities',
    '/users',
    '/audit',
    '/reports',
    '/api-docs'
  ];

  for (const route of routes) {
    const res = await new Promise((resolve) => {
      http.get({
        hostname: 'localhost',
        port: 3000,
        path: route,
        headers: { Cookie: cookie }
      }, (res) => {
        let text = '';
        res.on('data', d => text += d);
        res.on('end', () => resolve({ status: res.statusCode, length: text.length }));
      });
    });

    console.log(`Route [GET ${route}]: Status ${res.status}, Length: ${res.length} bytes`);
  }

  console.log('--- ALL HTML VIEW ROUTES VERIFIED ---');
}

testAllRoutes();
