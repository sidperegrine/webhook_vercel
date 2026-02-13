const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://sudhanshu_db_user:57noVDSClsUcZcnW@creataramongodb.g8c8bd1.mongodb.net/';

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

// External API Configuration
const MASTER_DATA_API = process.env.MASTER_DATA_API || 'https://7sq2mm2c13.execute-api.ap-south-1.amazonaws.com/prod/masterdata';

// Function to check if user exists in Master Data API
async function checkUserExistsInAPI(phoneNumber) {
  try {
    console.log('🔍 Checking user in Master Data API:', phoneNumber);
    
    const response = await axios.get(MASTER_DATA_API);
    
    if (!response.data || !response.data.success || !response.data.vehicles) {
      throw new Error('Invalid API response');
    }

    const vehicles = response.data.vehicles;
    
    // Search for user by phone number
    // Check both Phone_Number and CustomerMobile fields
    const user = vehicles.find(vehicle => {
      const cleanPhone = phoneNumber.replace(/[^\d]/g, ''); // Remove all non-digits
      const vehiclePhone = (vehicle.Phone_Number || '').replace(/[^\d]/g, '');
      const customerMobile = (vehicle.CustomerMobile || '').replace(/[^\d]/g, '');
      
      return vehiclePhone === cleanPhone || customerMobile === cleanPhone;
    });

    if (user) {
      console.log('✅ User found in Master Data API:', user.Name);
      return {
        exists: true,
        user: {
          phoneNumber: user.Phone_Number || user.CustomerMobile,
          name: user.Name,
          email: user.Email,
          registrationNumber: user.Registration_Number,
          model: user.Model_Number,
          address: user.Address,
          city: user.City,
          gender: user.Gender,
          age: user.Age,
          chassisNumber: user.ChassisNumber,
          dateOfPurchase: user.Date_of_Purchase,
          aadhaarNumber: user.Aadhaar_Number,
          // Include full data if needed
          fullData: user
        }
      };
    } else {
      console.log('❌ User not found in Master Data API:', phoneNumber);
      return {
        exists: false,
        user: null
      };
    }
  } catch (error) {
    console.error('Error checking Master Data API:', error.message);
    throw new Error('Failed to verify phone number');
  }
}

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

// MSG91 Configuration
const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY;
const MSG91_TEMPLATE_ID = process.env.MSG91_TEMPLATE_ID;
const MSG91_SENDER_ID = process.env.MSG91_SENDER_ID || 'OTPSMS';

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

// OTP Schema - stores OTPs temporarily
const otpSchema = new mongoose.Schema({
  phoneNumber: {
    type: String,
    required: true,
    index: true
  },
  otp: {
    type: String,
    required: true
  },
  purpose: {
    type: String,
    enum: ['login', 'signup', 'verification', 'password_reset'],
    default: 'login'
  },
  verified: {
    type: Boolean,
    default: false
  },
  attempts: {
    type: Number,
    default: 0
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 } // TTL index - auto-delete after expiry
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Create Models
const Webhook = mongoose.model('Webhook', webhookSchema);
const DeviceToken = mongoose.model('DeviceToken', deviceTokenSchema);
const OTP = mongoose.model('OTP', otpSchema);

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

// Function to generate OTP
function generateOTP(length = 6) {
  const digits = '0123456789';
  let otp = '';
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * 10)];
  }
  return otp;
}

// Function to send OTP via MSG91
async function sendOTPViaMSG91(phoneNumber, otp) {
  try {
    if (!MSG91_AUTH_KEY || !MSG91_TEMPLATE_ID) {
      throw new Error('MSG91 credentials not configured');
    }

    // MSG91 API endpoint
    const url = `https://control.msg91.com/api/v5/flow/`;

    const payload = {
      template_id: MSG91_TEMPLATE_ID,
      short_url: '0',
      recipients: [
        {
          mobiles: phoneNumber,
          OTP: otp // Variable name should match your MSG91 template variable
        }
      ]
    };

    const response = await axios.post(url, payload, {
      headers: {
        'authkey': MSG91_AUTH_KEY,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ OTP sent via MSG91:', response.data);
    
    return {
      success: true,
      messageId: response.data.message_id || response.data.request_id,
      data: response.data
    };
  } catch (error) {
    console.error('❌ MSG91 Error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.message || error.message
    };
  }
}

// Function to send push notification
async function sendPushNotification(payload, webhookId) {
  if (!firebaseInitialized) {
    console.log('⚠️ Firebase not initialized, skipping notification');
    return { success: false, reason: 'Firebase not configured' };
  }

  try {
    const devices = await DeviceToken.find({ active: true });
    
    if (devices.length === 0) {
      console.log('⚠️ No devices registered for push notifications');
      return { success: false, reason: 'No devices registered' };
    }

    const tokens = devices.map(d => d.token);

    const message = {
      notification: {
        title: payload.title || 'New Webhook Received',
        body: payload.message || JSON.stringify(payload).substring(0, 100),
      },
      data: {
        webhookId: webhookId.toString(),
        payload: JSON.stringify(payload),
        timestamp: new Date().toISOString()
      },
      tokens: tokens
    };

    const response = await admin.messaging().sendEachForMulticast(message);
    
    console.log(`✅ Push notifications sent: ${response.successCount}/${tokens.length}`);
    
    if (response.failureCount > 0) {
      const failedTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          failedTokens.push(tokens[idx]);
          console.error(`Failed to send to token ${idx}:`, resp.error);
        }
      });
      
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

// ==================== OTP ENDPOINTS ====================

// Send OTP - Check user exists first
app.post('/send-otp', ensureMongoConnection, async (req, res) => {
  try {
    const { phoneNumber, purpose = 'login' } = req.body;

    // Validate phone number
    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    // Clean phone number (remove spaces, dashes, etc.)
    const cleanPhone = phoneNumber.replace(/[^\d+]/g, '');

    // Check if user exists in DynamoDB
    const userCheck = await checkUserExistsInAPI(cleanPhone);

    if (!userCheck.exists) {
      return res.status(404).json({
        success: false,
        message: 'Phone number not registered',
        error: 'USER_NOT_FOUND'
      });
    }

    // Generate OTP
    const otp = generateOTP(6);

    // Save OTP to MongoDB (expires in 10 minutes)
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    
    // Delete any existing OTPs for this number
    await OTP.deleteMany({ phoneNumber: cleanPhone });

    const otpDoc = new OTP({
      phoneNumber: cleanPhone,
      otp: otp,
      purpose: purpose,
      expiresAt: expiresAt
    });

    await otpDoc.save();

    // Send OTP via MSG91
    const smsResult = await sendOTPViaMSG91(cleanPhone, otp);

    if (!smsResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to send OTP',
        error: smsResult.error
      });
    }

    console.log(`📱 OTP sent to ${cleanPhone}: ${otp}`);

    res.status(200).json({
      success: true,
      message: 'OTP sent successfully',
      phoneNumber: cleanPhone,
      expiresIn: 600, // seconds
      messageId: smsResult.messageId,
      // Don't send OTP in production! Only for development
      ...(process.env.NODE_ENV === 'development' && { otp: otp })
    });

  } catch (error) {
    console.error('❌ Error sending OTP:', error);
    res.status(500).json({
      success: false,
      message: 'Error sending OTP',
      error: error.message
    });
  }
});

// Verify OTP
app.post('/verify-otp', ensureMongoConnection, async (req, res) => {
  try {
    const { phoneNumber, otp } = req.body;

    if (!phoneNumber || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Phone number and OTP are required'
      });
    }

    const cleanPhone = phoneNumber.replace(/[^\d+]/g, '');

    // Find OTP in database
    const otpDoc = await OTP.findOne({
      phoneNumber: cleanPhone,
      verified: false
    }).sort({ createdAt: -1 });

    if (!otpDoc) {
      return res.status(404).json({
        success: false,
        message: 'No OTP found for this phone number',
        error: 'OTP_NOT_FOUND'
      });
    }

    // Check if OTP expired
    if (new Date() > otpDoc.expiresAt) {
      await OTP.deleteOne({ _id: otpDoc._id });
      return res.status(400).json({
        success: false,
        message: 'OTP has expired',
        error: 'OTP_EXPIRED'
      });
    }

    // Check attempts
    if (otpDoc.attempts >= 5) {
      await OTP.deleteOne({ _id: otpDoc._id });
      return res.status(429).json({
        success: false,
        message: 'Too many incorrect attempts',
        error: 'MAX_ATTEMPTS_EXCEEDED'
      });
    }

    // Verify OTP
    if (otpDoc.otp !== otp) {
      // Increment attempts
      otpDoc.attempts += 1;
      await otpDoc.save();

      return res.status(400).json({
        success: false,
        message: 'Invalid OTP',
        error: 'INVALID_OTP',
        attemptsRemaining: 5 - otpDoc.attempts
      });
    }

    // OTP is correct
    otpDoc.verified = true;
    await otpDoc.save();

    // Get user details from DynamoDB
    const userCheck = await checkUserExistsInAPI(cleanPhone);

    // Generate session token (you can use JWT here)
    const sessionToken = crypto.randomBytes(32).toString('hex');

    console.log(`✅ OTP verified for ${cleanPhone}`);

    res.status(200).json({
      success: true,
      message: 'OTP verified successfully',
      phoneNumber: cleanPhone,
      user: userCheck.user,
      sessionToken: sessionToken
    });

  } catch (error) {
    console.error('❌ Error verifying OTP:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying OTP',
      error: error.message
    });
  }
});

// Resend OTP
app.post('/resend-otp', ensureMongoConnection, async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    const cleanPhone = phoneNumber.replace(/[^\d+]/g, '');

    // Check if user exists in DynamoDB
    const userCheck = await checkUserExistsInAPI(cleanPhone);

    if (!userCheck.exists) {
      return res.status(404).json({
        success: false,
        message: 'Phone number not registered',
        error: 'USER_NOT_FOUND'
      });
    }

    // Delete old OTPs
    await OTP.deleteMany({ phoneNumber: cleanPhone });

    // Generate new OTP
    const otp = generateOTP(6);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const otpDoc = new OTP({
      phoneNumber: cleanPhone,
      otp: otp,
      purpose: 'login',
      expiresAt: expiresAt
    });

    await otpDoc.save();

    // Send OTP via MSG91
    const smsResult = await sendOTPViaMSG91(cleanPhone, otp);

    if (!smsResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to send OTP',
        error: smsResult.error
      });
    }

    res.status(200).json({
      success: true,
      message: 'OTP resent successfully',
      phoneNumber: cleanPhone,
      expiresIn: 600,
      ...(process.env.NODE_ENV === 'development' && { otp: otp })
    });

  } catch (error) {
    console.error('❌ Error resending OTP:', error);
    res.status(500).json({
      success: false,
      message: 'Error resending OTP',
      error: error.message
    });
  }
});

// Check if phone number exists
app.post('/check-phone', async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    const cleanPhone = phoneNumber.replace(/[^\d+]/g, '');

    const userCheck = await checkUserExistsInAPI(cleanPhone);

    res.status(200).json({
      success: true,
      exists: userCheck.exists,
      phoneNumber: cleanPhone
    });

  } catch (error) {
    console.error('❌ Error checking phone:', error);
    res.status(500).json({
      success: false,
      message: 'Error checking phone number',
      error: error.message
    });
  }
});

// ==================== EXISTING WEBHOOK ENDPOINTS ====================

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

    const notificationResult = await sendPushNotification(
      req.body,
      webhookData._id
    );

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

// [Rest of existing webhook endpoints...]
// (Keep all your existing webhook, device registration, and other endpoints)

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
    },
    msg91: {
      configured: !!(MSG91_AUTH_KEY && MSG91_TEMPLATE_ID)
    },
    masterDataAPI: {
      url: MASTER_DATA_API,
      configured: true
    }
  });
});

// Start server (only in local development)
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🚀 Webhook server running on port ${PORT}`);
    console.log(`📍 Webhook URL: http://localhost:${PORT}/webhook`);
    console.log(`📱 OTP URL: http://localhost:${PORT}/send-otp`);
  });
}

// Export for Vercel serverless
module.exports = app;





















// const express = require('express');
// const mongoose = require('mongoose');
// const bodyParser = require('body-parser');
// const admin = require('firebase-admin');

// const app = express();
// const PORT = process.env.PORT || 3000;

// // Middleware to parse JSON bodies
// app.use(bodyParser.json());
// app.use(bodyParser.urlencoded({ extended: true }));

// // MongoDB Connection
// const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/webhook_db';

// // MongoDB connection options optimized for Vercel serverless
// const mongoOptions = {
//   serverSelectionTimeoutMS: 10000,
//   socketTimeoutMS: 45000,
//   maxPoolSize: 10,
//   minPoolSize: 1,
// };

// // Connection promise to reuse across serverless function calls
// let mongoConnection = null;

// async function connectToMongoDB() {
//   if (mongoConnection && mongoose.connection.readyState === 1) {
//     return mongoConnection;
//   }

//   if (!mongoConnection) {
//     mongoConnection = mongoose.connect(MONGODB_URI, mongoOptions)
//       .then(() => {
//         console.log('✅ Connected to MongoDB');
//         return mongoose.connection;
//       })
//       .catch(err => {
//         console.error('❌ MongoDB connection error:', err);
//         console.error('Connection string (masked):', MONGODB_URI.replace(/\/\/.*@/, '//*****@'));
//         mongoConnection = null;
//         throw err;
//       });
//   }

//   return mongoConnection;
// }

// // Initialize connection
// connectToMongoDB();

// // Initialize Firebase Admin SDK
// let firebaseInitialized = false;
// try {
//   if (process.env.FIREBASE_SERVICE_ACCOUNT) {
//     const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
//     admin.initializeApp({
//       credential: admin.credential.cert(serviceAccount)
//     });
//     firebaseInitialized = true;
//     console.log('✅ Firebase Admin initialized');
//   } else {
//     console.log('⚠️ Firebase not configured - push notifications disabled');
//   }
// } catch (error) {
//   console.error('❌ Firebase initialization error:', error.message);
// }

// // Define Webhook Schema
// const webhookSchema = new mongoose.Schema({
//   payload: {
//     type: mongoose.Schema.Types.Mixed,
//     required: true
//   },
//   headers: {
//     type: Object,
//     default: {}
//   },
//   method: {
//     type: String,
//     required: true
//   },
//   timestamp: {
//     type: Date,
//     default: Date.now
//   },
//   sourceIp: String,
//   url: String,
//   notificationSent: {
//     type: Boolean,
//     default: false
//   },
//   notificationError: String
// });

// // Device Token Schema - stores FCM tokens from mobile devices
// const deviceTokenSchema = new mongoose.Schema({
//   token: {
//     type: String,
//     required: true,
//     unique: true
//   },
//   deviceInfo: {
//     platform: String,
//     deviceId: String,
//     appVersion: String
//   },
//   userId: String,
//   active: {
//     type: Boolean,
//     default: true
//   },
//   lastUsed: {
//     type: Date,
//     default: Date.now
//   },
//   createdAt: {
//     type: Date,
//     default: Date.now
//   }
// });

// // Create Models
// const Webhook = mongoose.model('Webhook', webhookSchema);
// const DeviceToken = mongoose.model('DeviceToken', deviceTokenSchema);

// // Middleware to ensure MongoDB connection
// async function ensureMongoConnection(req, res, next) {
//   try {
//     if (mongoose.connection.readyState !== 1) {
//       await connectToMongoDB();
//     }
//     next();
//   } catch (error) {
//     console.error('Failed to connect to MongoDB:', error);
//     res.status(503).json({
//       success: false,
//       message: 'Database connection unavailable',
//       error: error.message
//     });
//   }
// }

// // Function to send push notification
// async function sendPushNotification(payload, webhookId) {
//   if (!firebaseInitialized) {
//     console.log('⚠️ Firebase not initialized, skipping notification');
//     return { success: false, reason: 'Firebase not configured' };
//   }

//   try {
//     // Get all active device tokens
//     const devices = await DeviceToken.find({ active: true });
    
//     if (devices.length === 0) {
//       console.log('⚠️ No devices registered for push notifications');
//       return { success: false, reason: 'No devices registered' };
//     }

//     const tokens = devices.map(d => d.token);

//     // Create notification message
//     const message = {
//   tokens: tokens,

//   notification: {
//     title: payload.title || 'New Webhook Received',
//     body: payload.message || JSON.stringify(payload).substring(0, 100),
//   },

//   data: {
//     webhookId: webhookId.toString(),
//     payload: JSON.stringify(payload),
//     timestamp: new Date().toISOString()
//   },

//   apns: {
//     payload: {
//       aps: {
//         sound: "default",
//         badge: 1,
//         contentAvailable: true
//       }
//     },
//     headers: {
//       "apns-priority": "10"
//     }
//   }
// };

//     // const message = {
//     //   notification: {
//     //     title: payload.title || 'New Webhook Received',
//     //     body: payload.message || JSON.stringify(payload).substring(0, 100),
//     //   },
//     //   data: {
//     //     webhookId: webhookId.toString(),
//     //     payload: JSON.stringify(payload),
//     //     timestamp: new Date().toISOString()
//     //   },
//     //   tokens: tokens
//     // };

//     // Send to multiple devices
//     const response = await admin.messaging().sendEachForMulticast(message);
    
//     console.log(`✅ Push notifications sent: ${response.successCount}/${tokens.length}`);
    
//     // Handle failed tokens
//     if (response.failureCount > 0) {
//       const failedTokens = [];
//       response.responses.forEach((resp, idx) => {
//         if (!resp.success) {
//           failedTokens.push(tokens[idx]);
//           console.error(`Failed to send to token ${idx}:`, resp.error);
//         }
//       });
      
//       // Deactivate invalid tokens
//       await DeviceToken.updateMany(
//         { token: { $in: failedTokens } },
//         { active: false }
//       );
//     }

//     return {
//       success: true,
//       successCount: response.successCount,
//       failureCount: response.failureCount,
//       totalDevices: tokens.length
//     };
//   } catch (error) {
//     console.error('❌ Push notification error:', error);
//     return { success: false, error: error.message };
//   }
// }

// // Webhook endpoint - POST
// app.post('/webhook', ensureMongoConnection, async (req, res) => {
//   try {
//     const webhookData = new Webhook({
//       payload: req.body,
//       headers: req.headers,
//       method: req.method,
//       sourceIp: req.ip,
//       url: req.originalUrl
//     });

//     await webhookData.save();
    
//     console.log('📥 Webhook received and saved:', {
//       id: webhookData._id,
//       timestamp: webhookData.timestamp,
//       payload: webhookData.payload
//     });

//     // Send push notification
//     const notificationResult = await sendPushNotification(
//       req.body,
//       webhookData._id
//     );

//     // Update webhook with notification status
//     webhookData.notificationSent = notificationResult.success;
//     if (!notificationResult.success) {
//       webhookData.notificationError = notificationResult.reason || notificationResult.error;
//     }
//     await webhookData.save();

//     res.status(200).json({
//       success: true,
//       message: 'Webhook received successfully',
//       id: webhookData._id,
//       timestamp: webhookData.timestamp,
//       receivedData: webhookData.payload,
//       savedTo: 'MongoDB',
//       notification: notificationResult
//     });
//   } catch (error) {
//     console.error('❌ Error saving webhook:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Error processing webhook',
//       error: error.message
//     });
//   }
// });

// // Webhook endpoint - GET (for testing)
// app.get('/webhook', ensureMongoConnection, async (req, res) => {
//   try {
//     const webhookData = new Webhook({
//       payload: req.query,
//       headers: req.headers,
//       method: req.method,
//       sourceIp: req.ip,
//       url: req.originalUrl
//     });

//     await webhookData.save();
    
//     // Send push notification
//     const notificationResult = await sendPushNotification(
//       req.query,
//       webhookData._id
//     );

//     webhookData.notificationSent = notificationResult.success;
//     if (!notificationResult.success) {
//       webhookData.notificationError = notificationResult.reason || notificationResult.error;
//     }
//     await webhookData.save();
    
//     res.status(200).json({
//       success: true,
//       message: 'Webhook GET request received',
//       id: webhookData._id,
//       timestamp: webhookData.timestamp,
//       receivedData: webhookData.payload,
//       savedTo: 'MongoDB',
//       notification: notificationResult
//     });
//   } catch (error) {
//     console.error('❌ Error saving webhook:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Error processing webhook',
//       error: error.message
//     });
//   }
// });

// // Register device token for push notifications
// app.post('/register-device', ensureMongoConnection, async (req, res) => {
//   try {
//     const { token, deviceInfo, userId } = req.body;

//     if (!token) {
//       return res.status(400).json({
//         success: false,
//         message: 'Device token is required'
//       });
//     }

//     // Upsert device token
//     const device = await DeviceToken.findOneAndUpdate(
//       { token },
//       {
//         token,
//         deviceInfo,
//         userId,
//         active: true,
//         lastUsed: new Date()
//       },
//       { upsert: true, new: true }
//     );

//     console.log('📱 Device registered:', device._id);

//     res.status(200).json({
//       success: true,
//       message: 'Device registered successfully',
//       deviceId: device._id
//     });
//   } catch (error) {
//     console.error('❌ Error registering device:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Error registering device',
//       error: error.message
//     });
//   }
// });

// // Unregister device token
// app.post('/unregister-device', ensureMongoConnection, async (req, res) => {
//   try {
//     const { token } = req.body;

//     if (!token) {
//       return res.status(400).json({
//         success: false,
//         message: 'Device token is required'
//       });
//     }

//     await DeviceToken.findOneAndUpdate(
//       { token },
//       { active: false }
//     );

//     res.status(200).json({
//       success: true,
//       message: 'Device unregistered successfully'
//     });
//   } catch (error) {
//     console.error('❌ Error unregistering device:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Error unregistering device',
//       error: error.message
//     });
//   }
// });

// // Get all registered devices
// app.get('/devices', ensureMongoConnection, async (req, res) => {
//   try {
//     const devices = await DeviceToken.find({ active: true })
//       .select('-token') // Don't expose tokens
//       .sort({ lastUsed: -1 });
    
//     res.status(200).json({
//       success: true,
//       count: devices.length,
//       devices
//     });
//   } catch (error) {
//     console.error('❌ Error fetching devices:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Error fetching devices',
//       error: error.message
//     });
//   }
// });

// // Test notification endpoint
// app.post('/test-notification', ensureMongoConnection, async (req, res) => {
//   try {
//     const { title, message } = req.body;

//     const result = await sendPushNotification({
//       title: title || 'Test Notification',
//       message: message || 'This is a test notification from your webhook server'
//     }, 'test');

//     res.status(200).json({
//       success: true,
//       message: 'Test notification sent',
//       result
//     });
//   } catch (error) {
//     console.error('❌ Error sending test notification:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Error sending test notification',
//       error: error.message
//     });
//   }
// });

// // Get all webhooks
// app.get('/webhooks', ensureMongoConnection, async (req, res) => {
//   try {
//     const limit = parseInt(req.query.limit) || 10;
//     const webhooks = await Webhook.find()
//       .sort({ timestamp: -1 })
//       .limit(limit);
    
//     res.status(200).json({
//       success: true,
//       count: webhooks.length,
//       data: webhooks
//     });
//   } catch (error) {
//     console.error('❌ Error fetching webhooks:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Error fetching webhooks',
//       error: error.message
//     });
//   }
// });

// // Get webhook by ID
// app.get('/webhooks/:id', ensureMongoConnection, async (req, res) => {
//   try {
//     const webhook = await Webhook.findById(req.params.id);
    
//     if (!webhook) {
//       return res.status(404).json({
//         success: false,
//         message: 'Webhook not found'
//       });
//     }
    
//     res.status(200).json({
//       success: true,
//       data: webhook
//     });
//   } catch (error) {
//     console.error('❌ Error fetching webhook:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Error fetching webhook',
//       error: error.message
//     });
//   }
// });

// // Delete all webhooks (for testing)
// app.delete('/webhooks', ensureMongoConnection, async (req, res) => {
//   try {
//     const result = await Webhook.deleteMany({});
    
//     res.status(200).json({
//       success: true,
//       message: `Deleted ${result.deletedCount} webhooks`
//     });
//   } catch (error) {
//     console.error('❌ Error deleting webhooks:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Error deleting webhooks',
//       error: error.message
//     });
//   }
// });

// // Health check endpoint
// app.get('/health', (req, res) => {
//   const mongoStatus = mongoose.connection.readyState;
//   const statusMap = {
//     0: 'disconnected',
//     1: 'connected',
//     2: 'connecting',
//     3: 'disconnecting'
//   };
  
//   res.status(200).json({
//     success: true,
//     message: 'Server is running',
//     timestamp: new Date().toISOString(),
//     mongodb: {
//       status: statusMap[mongoStatus],
//       hasConnectionString: !!process.env.MONGODB_URI,
//       connectionStringPrefix: process.env.MONGODB_URI ? process.env.MONGODB_URI.substring(0, 14) : 'none'
//     },
//     firebase: {
//       initialized: firebaseInitialized,
//       configured: !!process.env.FIREBASE_SERVICE_ACCOUNT
//     }
//   });
// });

// // Start server (only in local development)
// if (process.env.NODE_ENV !== 'production') {
//   app.listen(PORT, () => {
//     console.log(`🚀 Webhook server running on port ${PORT}`);
//     console.log(`📍 Webhook URL: http://localhost:${PORT}/webhook`);
//     console.log(`📊 View all webhooks: http://localhost:${PORT}/webhooks`);
//   });
// }

// // Export for Vercel serverless
// module.exports = app;
