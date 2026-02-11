# Response Examples

## Example 1: POST Webhook Request

**Request:**
```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "event": "order.created",
    "order_id": "12345",
    "customer": {
      "name": "John Doe",
      "email": "john@example.com"
    },
    "total": 99.99
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Webhook received successfully",
  "id": "65c9f1234567890abcdef123",
  "timestamp": "2024-02-11T10:30:00.000Z",
  "receivedData": {
    "event": "order.created",
    "order_id": "12345",
    "customer": {
      "name": "John Doe",
      "email": "john@example.com"
    },
    "total": 99.99
  },
  "savedTo": "MongoDB"
}
```

**Saved in MongoDB:**
```json
{
  "_id": "65c9f1234567890abcdef123",
  "payload": {
    "event": "order.created",
    "order_id": "12345",
    "customer": {
      "name": "John Doe",
      "email": "john@example.com"
    },
    "total": 99.99
  },
  "headers": {
    "content-type": "application/json",
    "user-agent": "curl/7.64.1",
    "accept": "*/*",
    "content-length": "145",
    "host": "localhost:3000",
    "connection": "keep-alive"
  },
  "method": "POST",
  "sourceIp": "::1",
  "url": "/webhook",
  "timestamp": "2024-02-11T10:30:00.000Z"
}
```

## Example 2: GET Webhook Request

**Request:**
```bash
curl "http://localhost:3000/webhook?event=test&status=active&user_id=123"
```

**Response:**
```json
{
  "success": true,
  "message": "Webhook GET request received",
  "id": "65c9f2345678901bcdef456",
  "timestamp": "2024-02-11T10:31:00.000Z",
  "receivedData": {
    "event": "test",
    "status": "active",
    "user_id": "123"
  },
  "savedTo": "MongoDB"
}
```

## Example 3: Retrieve Webhooks from MongoDB

**Request:**
```bash
curl http://localhost:3000/webhooks?limit=5
```

**Response:**
```json
{
  "success": true,
  "count": 2,
  "data": [
    {
      "_id": "65c9f2345678901bcdef456",
      "payload": {
        "event": "test",
        "status": "active",
        "user_id": "123"
      },
      "headers": {
        "host": "localhost:3000",
        "user-agent": "curl/7.64.1"
      },
      "method": "GET",
      "sourceIp": "::1",
      "url": "/webhook?event=test&status=active&user_id=123",
      "timestamp": "2024-02-11T10:31:00.000Z"
    },
    {
      "_id": "65c9f1234567890abcdef123",
      "payload": {
        "event": "order.created",
        "order_id": "12345",
        "customer": {
          "name": "John Doe",
          "email": "john@example.com"
        },
        "total": 99.99
      },
      "headers": {
        "content-type": "application/json",
        "user-agent": "curl/7.64.1"
      },
      "method": "POST",
      "sourceIp": "::1",
      "url": "/webhook",
      "timestamp": "2024-02-11T10:30:00.000Z"
    }
  ]
}
```
