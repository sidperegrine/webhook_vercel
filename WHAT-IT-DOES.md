# What Does This Webhook Server Do?

## Overview
This is a **webhook receiver server** - it's like a mailbox for your application that receives and stores data sent from other services.

## Real-World Analogy
Think of it like a P.O. Box:
- Other services (like Stripe, PayPal, GitHub, etc.) send you messages (webhooks)
- Your server receives these messages
- It stores them in a database (MongoDB) so you can read them later
- It confirms receipt by sending back a response

## How It Works - Step by Step

### 1. **Someone Sends Data to Your Webhook**
External services or applications send HTTP requests to your webhook URL:
```
POST http://your-server.com/webhook
```

With data like:
```json
{
  "event": "payment_received",
  "amount": 100,
  "customer": "john@example.com"
}
```

### 2. **Your Server Receives It**
The Express.js server listens on port 3000 and catches the incoming request.

### 3. **Data is Saved to MongoDB**
The server automatically saves:
- The data you sent (payload)
- When it was received (timestamp)
- Who sent it (IP address)
- Request headers
- Request method (POST/GET)

### 4. **Confirmation Response**
The server sends back a confirmation with the data you sent:
```json
{
  "success": true,
  "id": "mongodb_document_id",
  "timestamp": "2024-02-11T10:30:00.000Z",
  "receivedData": { ...your original data... },
  "savedTo": "MongoDB"
}
```

### 5. **You Can View Your Data**
Access all received webhooks anytime:
```
GET http://your-server.com/webhooks
```

## Common Use Cases

### 1. **Payment Processing**
When Stripe processes a payment, it sends a webhook to notify you:
```json
{
  "type": "payment.success",
  "amount": 99.99,
  "customer_id": "cus_123"
}
```

### 2. **Form Submissions**
When someone submits a contact form on your website:
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "message": "I'm interested in your product"
}
```

### 3. **GitHub Events**
When someone creates a pull request on your repo:
```json
{
  "action": "opened",
  "pull_request": {
    "title": "Fix bug in authentication"
  }
}
```

### 4. **IoT Devices**
When a sensor detects something:
```json
{
  "sensor_id": "temp_01",
  "temperature": 25.5,
  "location": "warehouse_a"
}
```

## What Each File Does

### `webhook-server.js` (Main Server)
- Sets up the Express.js web server
- Connects to MongoDB database
- Defines API endpoints (routes)
- Handles incoming webhooks and saves them

### `package.json`
- Lists all the dependencies (libraries) needed
- Defines npm scripts (start, dev, test)

### `test-webhook.js`
- A test script to send sample webhook data
- Helps you verify the server is working

### `.env.example`
- Template for environment variables
- Shows how to configure MongoDB connection

### `README.md`
- Complete documentation
- Installation and usage instructions

### `EXAMPLES.md`
- Real examples of requests and responses
- Shows what data looks like in MongoDB

## The Technology Stack

1. **Node.js** - JavaScript runtime (the engine)
2. **Express.js** - Web framework (handles HTTP requests)
3. **MongoDB** - Database (stores the webhook data)
4. **Mongoose** - MongoDB library (makes database operations easier)

## Data Flow Diagram

```
External Service          Your Server              MongoDB
     |                        |                        |
     |--1. Send webhook----->|                        |
     |    (POST /webhook)    |                        |
     |                       |--2. Save data-------->|
     |                       |                        |
     |<--3. Confirmation-----|                        |
     |    (with body)        |                        |
     |                       |                        |
     |                       |<--4. Retrieve data----|
     |                       |    (GET /webhooks)    |
```

## API Endpoints Explained

### `POST /webhook`
**Purpose:** Receive webhook data
**When to use:** This is your main webhook URL
**What it does:** Saves incoming data to MongoDB and returns confirmation

### `GET /webhooks`
**Purpose:** View all received webhooks
**When to use:** When you want to see what webhooks you've received
**What it does:** Retrieves list of all webhooks from MongoDB

### `GET /webhooks/:id`
**Purpose:** View a specific webhook
**When to use:** When you know the ID and want details
**What it does:** Retrieves one specific webhook

### `DELETE /webhooks`
**Purpose:** Clear all webhooks
**When to use:** For testing or cleanup
**What it does:** Deletes all webhook records

### `GET /health`
**Purpose:** Check if server is running
**When to use:** For monitoring/health checks
**What it does:** Returns server status

## Why Would You Use This?

### 1. **Automation**
Automatically receive and process events from other services without manual intervention.

### 2. **Integration**
Connect different services together (e.g., when payment succeeds, send email).

### 3. **Data Collection**
Collect data from multiple sources in one place.

### 4. **Audit Trail**
Keep a record of all events that happened and when.

### 5. **Debugging**
See exactly what data external services are sending you.

## Example Workflow

Let's say you run an online store:

1. Customer makes a purchase on your website
2. Payment processor (Stripe) processes the payment
3. Stripe sends a webhook to your server: `POST /webhook`
4. Your server saves the payment details to MongoDB
5. You can later retrieve all payments: `GET /webhooks`
6. You can build features like:
   - Email receipts to customers
   - Update inventory
   - Generate reports
   - Track revenue

## Security Note

⚠️ **Important:** The basic version doesn't include authentication. For production, you should:
- Add webhook signature verification
- Use HTTPS
- Add rate limiting
- Implement proper error handling
- Add authentication

The README includes examples of how to add these security features.
