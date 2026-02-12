const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/webhook_db';

// MongoDB connection options optimized for Vercel serverless
const mongoOptions = {
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 45000,
  maxPoolSize: 10,
  minPoolSize: 1,
};

// Connection promise to reuse across serverless function calls
let mongoConnection = null;

async function connectToMongoDB() {
  if (mongoConnection && mongoose.connection.readyState === 1) {
    return mongoConnection;
  }

  if (!mongoConnection) {
    mongoConnection = mongoose.connect(MONGODB_URI, mongoOptions)
      .then(() => {
        console.log('✅ Connected to MongoDB');
        return mongoose.connection;
      })
      .catch(err => {
        console.error('❌ MongoDB connection error:', err);
        console.error('Connection string (masked):', MONGODB_URI.replace(/\/\/.*@/, '//*****@'));
        mongoConnection = null;
        throw err;
      });
  }

  return mongoConnection;
}

// Initialize connection
connectToMongoDB();

// Initialize Firebase Admin SDK
let firebaseInitialized = false;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    firebaseInitialized = true;
    console.log('✅ Firebase Admin initialized');
  } else {
    console.log('⚠️ Firebase not configured - push notifications disabled');
  }
} catch (error) {
  console.error('❌ Firebase initialization error:', error.message);
}

// Define Webhook Schema
const webhookSchema = new mongoose.Schema({
  payload: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  headers: {
    type: Object,
    default: {}
  },
  method: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  sourceIp: String,
  url: String,
  notificationSent: {
    type: Boolean,
    default: false
  },
  notificationError: String
});

// Device Token Schema - stores FCM tokens from mobile devices
const deviceTokenSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true
  },
  deviceInfo: {
    platform: String,
    deviceId: String,
    appVersion: String
  },
  userId: String,
  active: {
    type: Boolean,
    default: true
  },
  lastUsed: {
    type: Date,
    default: Date.now
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Create Models
const Webhook = mongoose.model('Webhook', webhookSchema);
const DeviceToken = mongoose.model('DeviceToken', deviceTokenSchema);

// Middleware to ensure MongoDB connection
async function ensureMongoConnection(req, res, next) {
  try {
    if (mongoose.connection.readyState !== 1) {
      await connectToMongoDB();
    }
    next();
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error);
    res.status(503).json({
      success: false,
      message: 'Database connection unavailable',
      error: error.message
    });
  }
}

// Function to send push notification
async function sendPushNotification(payload, webhookId) {
  if (!firebaseInitialized) {
    console.log('⚠️ Firebase not initialized, skipping notification');
    return { success: false, reason: 'Firebase not configured' };
  }

  try {
    // Get all active device tokens
    const devices = await DeviceToken.find({ active: true });
    
    if (devices.length === 0) {
      console.log('⚠️ No devices registered for push notifications');
      return { success: false, reason: 'No devices registered' };
    }

    const tokens = devices.map(d => d.token);

    // Create notification message
    const message = {
  tokens: tokens,

  notification: {
    title: payload.title || 'New Webhook Received',
    body: payload.message || JSON.stringify(payload).substring(0, 100),
  },

  data: {
    webhookId: webhookId.toString(),
    payload: JSON.stringify(payload),
    timestamp: new Date().toISOString()
  },

  apns: {
    payload: {
      aps: {
        sound: "default",
        badge: 1,
        contentAvailable: true
      }
    },
    headers: {
      "apns-priority": "10"
    }
  }
};

    // const message = {
    //   notification: {
    //     title: payload.title || 'New Webhook Received',
    //     body: payload.message || JSON.stringify(payload).substring(0, 100),
    //   },
    //   data: {
    //     webhookId: webhookId.toString(),
    //     payload: JSON.stringify(payload),
    //     timestamp: new Date().toISOString()
    //   },
    //   tokens: tokens
    // };

    // Send to multiple devices
    const response = await admin.messaging().sendEachForMulticast(message);
    
    console.log(`✅ Push notifications sent: ${response.successCount}/${tokens.length}`);
    
    // Handle failed tokens
    if (response.failureCount > 0) {
      const failedTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          failedTokens.push(tokens[idx]);
          console.error(`Failed to send to token ${idx}:`, resp.error);
        }
      });
      
      // Deactivate invalid tokens
      await DeviceToken.updateMany(
        { token: { $in: failedTokens } },
        { active: false }
      );
    }

    return {
      success: true,
      successCount: response.successCount,
      failureCount: response.failureCount,
      totalDevices: tokens.length
    };
  } catch (error) {
    console.error('❌ Push notification error:', error);
    return { success: false, error: error.message };
  }
}

// Webhook endpoint - POST
app.post('/webhook', ensureMongoConnection, async (req, res) => {
  try {
    const webhookData = new Webhook({
      payload: req.body,
      headers: req.headers,
      method: req.method,
      sourceIp: req.ip,
      url: req.originalUrl
    });

    await webhookData.save();
    
    console.log('📥 Webhook received and saved:', {
      id: webhookData._id,
      timestamp: webhookData.timestamp,
      payload: webhookData.payload
    });

    // Send push notification
    const notificationResult = await sendPushNotification(
      req.body,
      webhookData._id
    );

    // Update webhook with notification status
    webhookData.notificationSent = notificationResult.success;
    if (!notificationResult.success) {
      webhookData.notificationError = notificationResult.reason || notificationResult.error;
    }
    await webhookData.save();

    res.status(200).json({
      success: true,
      message: 'Webhook received successfully',
      id: webhookData._id,
      timestamp: webhookData.timestamp,
      receivedData: webhookData.payload,
      savedTo: 'MongoDB',
      notification: notificationResult
    });
  } catch (error) {
    console.error('❌ Error saving webhook:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing webhook',
      error: error.message
    });
  }
});

// Webhook endpoint - GET (for testing)
app.get('/webhook', ensureMongoConnection, async (req, res) => {
  try {
    const webhookData = new Webhook({
      payload: req.query,
      headers: req.headers,
      method: req.method,
      sourceIp: req.ip,
      url: req.originalUrl
    });

    await webhookData.save();
    
    // Send push notification
    const notificationResult = await sendPushNotification(
      req.query,
      webhookData._id
    );

    webhookData.notificationSent = notificationResult.success;
    if (!notificationResult.success) {
      webhookData.notificationError = notificationResult.reason || notificationResult.error;
    }
    await webhookData.save();
    
    res.status(200).json({
      success: true,
      message: 'Webhook GET request received',
      id: webhookData._id,
      timestamp: webhookData.timestamp,
      receivedData: webhookData.payload,
      savedTo: 'MongoDB',
      notification: notificationResult
    });
  } catch (error) {
    console.error('❌ Error saving webhook:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing webhook',
      error: error.message
    });
  }
});

// Register device token for push notifications
app.post('/register-device', ensureMongoConnection, async (req, res) => {
  try {
    const { token, deviceInfo, userId } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Device token is required'
      });
    }

    // Upsert device token
    const device = await DeviceToken.findOneAndUpdate(
      { token },
      {
        token,
        deviceInfo,
        userId,
        active: true,
        lastUsed: new Date()
      },
      { upsert: true, new: true }
    );

    console.log('📱 Device registered:', device._id);

    res.status(200).json({
      success: true,
      message: 'Device registered successfully',
      deviceId: device._id
    });
  } catch (error) {
    console.error('❌ Error registering device:', error);
    res.status(500).json({
      success: false,
      message: 'Error registering device',
      error: error.message
    });
  }
});

// Unregister device token
app.post('/unregister-device', ensureMongoConnection, async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Device token is required'
      });
    }

    await DeviceToken.findOneAndUpdate(
      { token },
      { active: false }
    );

    res.status(200).json({
      success: true,
      message: 'Device unregistered successfully'
    });
  } catch (error) {
    console.error('❌ Error unregistering device:', error);
    res.status(500).json({
      success: false,
      message: 'Error unregistering device',
      error: error.message
    });
  }
});

// Get all registered devices
app.get('/devices', ensureMongoConnection, async (req, res) => {
  try {
    const devices = await DeviceToken.find({ active: true })
      .select('-token') // Don't expose tokens
      .sort({ lastUsed: -1 });
    
    res.status(200).json({
      success: true,
      count: devices.length,
      devices
    });
  } catch (error) {
    console.error('❌ Error fetching devices:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching devices',
      error: error.message
    });
  }
});

// Test notification endpoint
app.post('/test-notification', ensureMongoConnection, async (req, res) => {
  try {
    const { title, message } = req.body;

    const result = await sendPushNotification({
      title: title || 'Test Notification',
      message: message || 'This is a test notification from your webhook server'
    }, 'test');

    res.status(200).json({
      success: true,
      message: 'Test notification sent',
      result
    });
  } catch (error) {
    console.error('❌ Error sending test notification:', error);
    res.status(500).json({
      success: false,
      message: 'Error sending test notification',
      error: error.message
    });
  }
});

// Get all webhooks
app.get('/webhooks', ensureMongoConnection, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const webhooks = await Webhook.find()
      .sort({ timestamp: -1 })
      .limit(limit);
    
    res.status(200).json({
      success: true,
      count: webhooks.length,
      data: webhooks
    });
  } catch (error) {
    console.error('❌ Error fetching webhooks:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching webhooks',
      error: error.message
    });
  }
});

// Get webhook by ID
app.get('/webhooks/:id', ensureMongoConnection, async (req, res) => {
  try {
    const webhook = await Webhook.findById(req.params.id);
    
    if (!webhook) {
      return res.status(404).json({
        success: false,
        message: 'Webhook not found'
      });
    }
    
    res.status(200).json({
      success: true,
      data: webhook
    });
  } catch (error) {
    console.error('❌ Error fetching webhook:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching webhook',
      error: error.message
    });
  }
});

// Delete all webhooks (for testing)
app.delete('/webhooks', ensureMongoConnection, async (req, res) => {
  try {
    const result = await Webhook.deleteMany({});
    
    res.status(200).json({
      success: true,
      message: `Deleted ${result.deletedCount} webhooks`
    });
  } catch (error) {
    console.error('❌ Error deleting webhooks:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting webhooks',
      error: error.message
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  const mongoStatus = mongoose.connection.readyState;
  const statusMap = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
  };
  
  res.status(200).json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    mongodb: {
      status: statusMap[mongoStatus],
      hasConnectionString: !!process.env.MONGODB_URI,
      connectionStringPrefix: process.env.MONGODB_URI ? process.env.MONGODB_URI.substring(0, 14) : 'none'
    },
    firebase: {
      initialized: firebaseInitialized,
      configured: !!process.env.FIREBASE_SERVICE_ACCOUNT
    }
  });
});

// Start server (only in local development)
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🚀 Webhook server running on port ${PORT}`);
    console.log(`📍 Webhook URL: http://localhost:${PORT}/webhook`);
    console.log(`📊 View all webhooks: http://localhost:${PORT}/webhooks`);
  });
}

// Export for Vercel serverless
module.exports = app;
