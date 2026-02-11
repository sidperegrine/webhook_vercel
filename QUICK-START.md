# Quick Start Summary

## What This Does
A webhook receiver that catches HTTP requests and saves them to MongoDB. Perfect for:
- Receiving payment notifications from Stripe/PayPal
- Collecting form submissions
- Getting notifications from GitHub/GitLab
- IoT sensor data collection
- Any automated data collection

## The Files You Have

```
webhook-server/
├── webhook-server.js          # Main server code
├── package.json               # Dependencies
├── vercel.json               # Vercel configuration
├── .gitignore                # Files to ignore in git
├── README.md                 # Complete documentation
├── EXAMPLES.md               # Request/response examples
├── WHAT-IT-DOES.md          # Detailed explanation
├── VERCEL-DEPLOYMENT.md     # Deployment guide
└── test-webhook.js          # Local testing script
```

## Local Testing (3 Steps)

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start MongoDB** (locally or use connection string)

3. **Run the server:**
   ```bash
   npm start
   ```

4. **Test it:**
   ```bash
   npm test
   ```

Your webhook is at: `http://localhost:3000/webhook`

## Deploy to Vercel (5 Steps)

1. **Create MongoDB Atlas account** (free)
   - Get connection string

2. **Push code to GitHub**
   - Create repo, upload files

3. **Sign up for Vercel** (free)
   - Connect with GitHub

4. **Import project**
   - Add MONGODB_URI environment variable

5. **Deploy!**
   - Get your live URL: `https://your-app.vercel.app/webhook`

Full guide: See `VERCEL-DEPLOYMENT.md`

## Key Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/webhook` | POST | Receive webhook data |
| `/webhook` | GET | Receive via query params |
| `/webhooks` | GET | View all webhooks |
| `/webhooks/:id` | GET | View specific webhook |
| `/webhooks` | DELETE | Clear all webhooks |
| `/health` | GET | Server status |

## Example Usage

**Send webhook:**
```bash
curl -X POST https://your-app.vercel.app/webhook \
  -H "Content-Type: application/json" \
  -d '{"event": "order.created", "order_id": "12345"}'
```

**Response you get:**
```json
{
  "success": true,
  "id": "65c9f1234567890abcdef123",
  "timestamp": "2024-02-11T10:30:00.000Z",
  "receivedData": {
    "event": "order.created",
    "order_id": "12345"
  },
  "savedTo": "MongoDB"
}
```

**View all webhooks:**
```bash
curl https://your-app.vercel.app/webhooks
```

## What Gets Saved to MongoDB

```json
{
  "_id": "unique_id",
  "payload": { ...your data... },
  "headers": { ...request headers... },
  "method": "POST",
  "sourceIp": "xxx.xxx.xxx.xxx",
  "url": "/webhook",
  "timestamp": "2024-02-11T10:30:00.000Z"
}
```

## Need More Info?

- **What it does:** Read `WHAT-IT-DOES.md`
- **Deploy to Vercel:** Read `VERCEL-DEPLOYMENT.md`
- **See examples:** Read `EXAMPLES.md`
- **Full docs:** Read `README.md`
