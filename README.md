# Webhook Server with MongoDB

A simple Node.js webhook server that receives HTTP requests and stores them in MongoDB.

## Features

- ✅ Receive webhook POST/GET requests
- ✅ Store webhook data in MongoDB
- ✅ View all received webhooks
- ✅ Query webhooks by ID
- ✅ Delete webhooks
- ✅ Health check endpoint

## Prerequisites

- Node.js (v14 or higher)
- MongoDB (local or MongoDB Atlas)

## Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up MongoDB:**
   
   **Option A: Local MongoDB**
   - Install MongoDB locally
   - Start MongoDB service:
     ```bash
     # On macOS with Homebrew
     brew services start mongodb-community
     
     # On Ubuntu
     sudo systemctl start mongod
     
     # On Windows
     net start MongoDB
     ```

   **Option B: MongoDB Atlas (Cloud)**
   - Create a free account at https://www.mongodb.com/cloud/atlas
   - Create a cluster
   - Get your connection string
   - Update the MONGODB_URI in the code or use environment variables

3. **Configure environment (optional):**
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

## Usage

### Start the server:

```bash
npm start
```

Or for development with auto-reload:
```bash
npm run dev
```

The server will start on `http://localhost:3000`

### Test the webhook:

Open another terminal and run:
```bash
npm test
```

Or use curl:
```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{"event": "test", "data": {"message": "Hello World"}}'
```

## API Endpoints

### 1. Receive Webhook (POST)
```
POST /webhook
```
Receives and stores webhook data.

**Example:**
```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{"event": "order.created", "order_id": "12345"}'
```

### 2. Receive Webhook (GET)
```
GET /webhook?param1=value1&param2=value2
```

### 3. Get All Webhooks
```
GET /webhooks?limit=10
```
Retrieves all stored webhooks (default limit: 10).

**Example:**
```bash
curl http://localhost:3000/webhooks
```

### 4. Get Webhook by ID
```
GET /webhooks/:id
```

**Example:**
```bash
curl http://localhost:3000/webhooks/507f1f77bcf86cd799439011
```

### 5. Delete All Webhooks
```
DELETE /webhooks
```
⚠️ Use with caution - deletes all webhook records.

### 6. Health Check
```
GET /health
```

## Webhook Data Structure

Each webhook is stored with the following fields:

```json
{
  "_id": "MongoDB ObjectId",
  "payload": {}, // The actual webhook data
  "headers": {}, // Request headers
  "method": "POST",
  "sourceIp": "::1",
  "url": "/webhook",
  "timestamp": "2024-02-11T10:30:00.000Z"
}
```

## Database Schema

```javascript
{
  payload: Mixed (any JSON data),
  headers: Object,
  method: String,
  sourceIp: String,
  url: String,
  timestamp: Date (auto-generated)
}
```

## Testing with External Services

To test with external webhook providers (like Stripe, GitHub, etc.):

1. **Use a tunneling service** to expose your local server:
   
   **Using ngrok:**
   ```bash
   # Install ngrok
   npm install -g ngrok
   
   # Expose your local server
   ngrok http 3000
   ```
   
   This will give you a public URL like: `https://abc123.ngrok.io`

2. **Configure the webhook URL** in your external service:
   ```
   https://abc123.ngrok.io/webhook
   ```

## Production Deployment

For production, consider:

1. **Environment Variables:** Use proper environment variables for sensitive data
2. **Authentication:** Add webhook signature verification
3. **Rate Limiting:** Implement rate limiting to prevent abuse
4. **Logging:** Add proper logging (Winston, Morgan)
5. **Error Handling:** Enhanced error handling and monitoring
6. **HTTPS:** Use HTTPS in production
7. **Database Indexing:** Add indexes for better query performance

## Example: Adding Webhook Signature Verification

```javascript
const crypto = require('crypto');

function verifyWebhookSignature(payload, signature, secret) {
  const hash = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
  
  return hash === signature;
}

// Use in your webhook endpoint
app.post('/webhook', async (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const secret = process.env.WEBHOOK_SECRET;
  
  if (!verifyWebhookSignature(req.body, signature, secret)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  // Process webhook...
});
```

## Troubleshooting

**MongoDB Connection Error:**
- Ensure MongoDB is running
- Check your connection string
- Verify network access (for MongoDB Atlas)

**Port Already in Use:**
- Change the PORT in .env or use:
  ```bash
  PORT=4000 npm start
  ```

## License

ISC
