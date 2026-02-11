const http = require('http');

// Test data to send to webhook
const testData = {
  event: 'user.signup',
  user: {
    id: '12345',
    email: 'test@example.com',
    name: 'Test User'
  },
  timestamp: new Date().toISOString(),
  metadata: {
    source: 'web',
    campaign: 'summer_2024'
  }
};

// Configuration
const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/webhook',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Webhook-Secret': 'your-secret-key',
    'X-Event-Type': 'user.signup'
  }
};

// Send POST request
const req = http.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log('✅ Response Status:', res.statusCode);
    console.log('📦 Response Body:', data);
    
    try {
      const jsonData = JSON.parse(data);
      console.log('📝 Webhook ID:', jsonData.id);
    } catch (e) {
      console.log('Response is not JSON');
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Error:', error.message);
  console.log('💡 Make sure the server is running: npm start');
});

// Write data to request body
req.write(JSON.stringify(testData));
req.end();

console.log('📤 Sending test webhook...');
