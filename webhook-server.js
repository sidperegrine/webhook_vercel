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
const MONGODB_URI = 'mongodb+srv://sudhanshu_db_user:57noVDSClsUcZcnW@creataramongodb.g8c8bd1.mongodb.net/';


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
      // Normalize all phone numbers for comparison (removes +91 for matching)
      const searchPhone = phoneNumber.replace(/[^\d]/g, ''); // Remove all non-digits from search
      const vehiclePhone = (vehicle.Phone_Number || '').replace(/[^\d]/g, '');
      const customerMobile = (vehicle.CustomerMobile || '').replace(/[^\d]/g, '');
      
      // Match last 10 digits (handles both +91XXXXXXXXXX and XXXXXXXXXX)
      return vehiclePhone.slice(-10) === searchPhone.slice(-10) || 
             customerMobile.slice(-10) === searchPhone.slice(-10);
    });

    if (user) {
      console.log('✅ User found in Master Data API:', user.Name);
      return {
        exists: true,
        user: {
          phoneNumber: normalizePhoneNumber(user.Phone_Number || user.CustomerMobile),
          name: user.Name,
          email: user.Email,
          vehicleId: user.Display_Serial_Number,  // Vehicle ID for telemetry
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
  // User identifiers
  phoneNumber: {
    type: String,
    required: true,
    index: true
  },
  userId: String,
  
  // Vehicle identifiers
  vehicleId: {
    type: String,
    index: true  // Display_Serial_Number from Master API
  },
  registrationNumber: {
    type: String,
    index: true
  },
  chassisNumber: {
    type: String,
    index: true
  },
  
  // Device info
  deviceInfo: {
    platform: String,
    deviceId: String,
    appVersion: String
  },
  
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

// Create indexes for fast lookups
deviceTokenSchema.index({ vehicleId: 1 });
deviceTokenSchema.index({ registrationNumber: 1 });
deviceTokenSchema.index({ chassisNumber: 1 });

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

// Telemetry Log Schema - stores all incoming telemetry events
const telemetryLogSchema = new mongoose.Schema({
  deviceId: {
    type: String,
    required: true,
    index: true
  },
  event: {
    type: String,
    required: true,
    index: true
  },
  timestamp: {
    type: String,
    required: true
  },
  rawPayload: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  // Notification tracking
  notificationSent: {
    type: Boolean,
    default: false
  },
  devicesNotified: {
    type: Number,
    default: 0
  },
  notificationError: String,
  // Metadata
  receivedAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  processedAt: Date
});

// Create indexes for queries
telemetryLogSchema.index({ deviceId: 1, receivedAt: -1 });
telemetryLogSchema.index({ event: 1, receivedAt: -1 });

// Create Models
const Webhook = mongoose.model('Webhook', webhookSchema);
const DeviceToken = mongoose.model('DeviceToken', deviceTokenSchema);
const OTP = mongoose.model('OTP', otpSchema);
const TelemetryLog = mongoose.model('TelemetryLog', telemetryLogSchema);

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
function generateOTP(length = 4) {
  const digits = '0123456789';
  let otp = '';
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * 10)];
  }
  return otp;
}

// Function to normalize phone number with +91 prefix
function normalizePhoneNumber(phoneNumber) {
  // Remove all non-digit characters except +
  let cleaned = phoneNumber.replace(/[^\d+]/g, '');
  
  // If it starts with +91, return as is
  if (cleaned.startsWith('+91')) {
    return cleaned;
  }
  
  // If it starts with 91 (without +), add the +
  if (cleaned.startsWith('91') && cleaned.length === 12) {
    return '+' + cleaned;
  }
  
  // If it's a 10-digit number, add +91
  if (cleaned.length === 10) {
    return '+91' + cleaned;
  }
  
  // If it starts with 0, remove it and add +91
  if (cleaned.startsWith('0') && cleaned.length === 11) {
    return '+91' + cleaned.substring(1);
  }
  
  // Return as is if already has + or doesn't match patterns
  return cleaned;
}

// Telemetry Event Templates - Smart notifications based on event type
const eventTemplates = {
  // Battery Events
  "BATTERY_HIGH_TEMPERATURE": {
    title: "⚠️ Battery Warning",
    body: "Your vehicle battery temperature is high. Please stop and let it cool down.",
    priority: "high",
    sound: "alert"
  },
  "BATTERY_LOW_VOLTAGE": {
    title: "🔋 Low Battery",
    body: "Your vehicle battery voltage is low. Please charge soon.",
    priority: "high",
    sound: "default"
  },
  "BATTERY_CRITICAL_LOW": {
    title: "🚨 Critical Battery",
    body: "Battery critically low! Find a charging station immediately.",
    priority: "critical",
    sound: "alert"
  },
  "CHARGE_OVER_TEMPERATURE": {
    title: "⚠️ Charging Alert",
    body: "Charging temperature too high. Charging stopped for safety.",
    priority: "high",
    sound: "alert"
  },
  "CHARGING_COMPLETE": {
    title: "✅ Charging Complete",
    body: "Your vehicle is fully charged and ready to go!",
    priority: "normal",
    sound: "default"
  },
  "CHARGING_STARTED": {
    title: "🔌 Charging Started",
    body: "Your vehicle is now charging.",
    priority: "normal",
    sound: "default"
  },
  
  // Motor/MCU Events
  "MCU_DCBUS_OVERCURRENT": {
    title: "🚨 Motor Fault Alert",
    body: "Critical motor fault detected. Please stop immediately and contact service.",
    priority: "critical",
    sound: "alert"
  },
  "MOTOR_OVERHEAT": {
    title: "⚠️ Motor Overheating",
    body: "Motor temperature is too high. Please stop and let it cool.",
    priority: "high",
    sound: "alert"
  },
  "MOTOR_FAULT": {
    title: "⚠️ Motor Issue",
    body: "Motor fault detected. Please have your vehicle serviced.",
    priority: "high",
    sound: "alert"
  },
  "CONTROLLER_FAULT": {
    title: "⚠️ Controller Error",
    body: "Controller fault detected. Service required.",
    priority: "high",
    sound: "alert"
  },
  
  // System Events
  "SOFTWARE_UPDATE_AVAILABLE": {
    title: "📲 Update Available",
    body: "New software update is available for your vehicle.",
    priority: "normal",
    sound: "default"
  },
  "SERVICE_DUE": {
    title: "🔧 Service Reminder",
    body: "Your vehicle is due for service. Please schedule an appointment.",
    priority: "normal",
    sound: "default"
  },
  "MAINTENANCE_REQUIRED": {
    title: "🔧 Maintenance Required",
    body: "Your vehicle requires maintenance. Please check your app for details.",
    priority: "normal",
    sound: "default"
  },
  
  // Security Events
  "THEFT_ALERT": {
    title: "🚨 Security Alert",
    body: "Unauthorized access detected! Check your vehicle immediately.",
    priority: "critical",
    sound: "alert"
  },
  "GEOFENCE_EXIT": {
    title: "📍 Geofence Alert",
    body: "Your vehicle has exited the designated area.",
    priority: "high",
    sound: "alert"
  },
  "UNAUTHORIZED_ACCESS": {
    title: "🔒 Security Alert",
    body: "Unauthorized access attempt detected.",
    priority: "critical",
    sound: "alert"
  },
  
  // Operational
  "LOW_BATTERY_WARNING": {
    title: "🔋 Low Battery",
    body: "Battery running low. Please charge soon.",
    priority: "high",
    sound: "default"
  },
  "RANGE_LOW": {
    title: "📉 Low Range",
    body: "Vehicle range is low. Plan to charge soon.",
    priority: "high",
    sound: "default"
  },
  "SPEED_LIMIT_EXCEEDED": {
    title: "⚠️ Speed Alert",
    body: "Speed limit exceeded. Please drive safely.",
    priority: "normal",
    sound: "default"
  },
  
  // Default template for unknown events
  "DEFAULT": {
    title: "🔔 Vehicle Alert",
    body: "Your vehicle requires attention. Check your app for details.",
    priority: "normal",
    sound: "default"
  }
};

// Function to get event notification template
function getEventTemplate(eventType) {
  return eventTemplates[eventType] || eventTemplates["DEFAULT"];
}

// Function to send OTP via MSG91
async function sendOTPViaMSG91(phoneNumber, otp) {
  try {
    if (!MSG91_AUTH_KEY || !MSG91_TEMPLATE_ID) {
      throw new Error('MSG91 credentials not configured');
    }

    // Ensure phone number has +91 prefix
    const formattedPhone = normalizePhoneNumber(phoneNumber);

    // MSG91 OTP API endpoint with query parameters
    const url = `https://control.msg91.com/api/v5/otp?template_id=${MSG91_TEMPLATE_ID}&mobile=${formattedPhone}&authkey=${MSG91_AUTH_KEY}`;

    console.log(`📤 Sending OTP to ${formattedPhone} via MSG91`);

    const response = await axios.post(url, {}, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ OTP sent via MSG91:', response.data);
    
    return {
      success: true,
      messageId: response.data.request_id || response.data.type,
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

    // Clean and normalize phone number with +91 prefix
    const cleanPhone = normalizePhoneNumber(phoneNumber);

    // Check if user exists in DynamoDB
    const userCheck = await checkUserExistsInAPI(cleanPhone);

    if (!userCheck.exists) {
      return res.status(404).json({
        success: false,
        message: 'Phone number not registered',
        error: 'USER_NOT_FOUND'
      });
    }

    // Generate OTP (4 digits)
    const otp = generateOTP(4);

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

    // Validate OTP is 4 digits
    if (!/^\d{4}$/.test(otp)) {
      return res.status(400).json({
        success: false,
        message: 'OTP must be 4 digits',
        error: 'INVALID_OTP_FORMAT'
      });
    }

    const cleanPhone = normalizePhoneNumber(phoneNumber);

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

    // Verify OTP with MSG91
    try {
      const verifyUrl = `https://control.msg91.com/api/v5/otp/verify?otp=${otp}&mobile=${cleanPhone}`;
      
      const msg91Response = await axios.get(verifyUrl, {
        headers: {
          'authkey': MSG91_AUTH_KEY
        }
      });

      console.log('✅ MSG91 verification response:', msg91Response.data);

      // Check if MSG91 verification was successful
      if (msg91Response.data.type !== 'success') {
        // Increment attempts in our database
        otpDoc.attempts += 1;
        await otpDoc.save();

        return res.status(400).json({
          success: false,
          message: 'Invalid OTP',
          error: 'INVALID_OTP',
          attemptsRemaining: 5 - otpDoc.attempts
        });
      }

    } catch (msg91Error) {
      console.error('❌ MSG91 verification error:', msg91Error.response?.data || msg91Error.message);
      
      // Increment attempts
      otpDoc.attempts += 1;
      await otpDoc.save();

      return res.status(400).json({
        success: false,
        message: 'Invalid OTP or verification failed',
        error: 'INVALID_OTP',
        attemptsRemaining: 5 - otpDoc.attempts
      });
    }

    // OTP is correct - mark as verified
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

    const cleanPhone = normalizePhoneNumber(phoneNumber);

    // Check if user exists in DynamoDB
    const userCheck = await checkUserExistsInAPI(cleanPhone);

    if (!userCheck.exists) {
      return res.status(404).json({
        success: false,
        message: 'Phone number not registered',
        error: 'USER_NOT_FOUND'
      });
    }

    // Delete old OTPs from our database
    await OTP.deleteMany({ phoneNumber: cleanPhone });

    // Use MSG91 retry API to resend OTP
    try {
      const retryUrl = `https://control.msg91.com/api/v5/otp/retry?mobile=${cleanPhone}&authkey=${MSG91_AUTH_KEY}&retrytype=text`;
      
      const msg91Response = await axios.get(retryUrl);

      console.log('✅ MSG91 retry response:', msg91Response.data);

      if (msg91Response.data.type !== 'success') {
        return res.status(500).json({
          success: false,
          message: 'Failed to resend OTP',
          error: msg91Response.data.message || 'MSG91 retry failed'
        });
      }

      // Save new OTP record in our database for tracking
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      const otpDoc = new OTP({
        phoneNumber: cleanPhone,
        otp: 'resent', // MSG91 handles the actual OTP
        purpose: 'login',
        expiresAt: expiresAt
      });
      await otpDoc.save();

      res.status(200).json({
        success: true,
        message: 'OTP resent successfully',
        phoneNumber: cleanPhone,
        expiresIn: 600
      });

    } catch (msg91Error) {
      console.error('❌ MSG91 retry error:', msg91Error.response?.data || msg91Error.message);
      return res.status(500).json({
        success: false,
        message: 'Failed to resend OTP',
        error: msg91Error.response?.data?.message || msg91Error.message
      });
    }

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

    const cleanPhone = normalizePhoneNumber(phoneNumber);

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

// ==================== TELEMETRY ENDPOINTS ====================

// Telemetry webhook - receives vehicle events and sends targeted notifications
app.post('/telemetry', ensureMongoConnection, async (req, res) => {
  try {
    const telemetryData = req.body;

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 TELEMETRY RECEIVED');
    console.log('Time:', new Date().toISOString());
    console.log('Device ID:', telemetryData.deviceId);
    console.log('Event:', telemetryData.event);
    console.log('Timestamp:', telemetryData.timestamp);
    console.log('Payload:', JSON.stringify(telemetryData, null, 2));
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Validate required fields
    if (!telemetryData.deviceId || !telemetryData.event) {
      return res.status(400).json({
        success: false,
        message: 'deviceId and event are required'
      });
    }

    // Save telemetry log to database
    const telemetryLog = new TelemetryLog({
      deviceId: telemetryData.deviceId,
      event: telemetryData.event,
      timestamp: telemetryData.timestamp || new Date().toISOString(),
      rawPayload: telemetryData,
      receivedAt: new Date()
    });

    await telemetryLog.save();
    console.log('✅ Telemetry logged to database:', telemetryLog._id);

    // Find devices registered with this vehicle ID
    const devices = await DeviceToken.find({
      vehicleId: telemetryData.deviceId,
      active: true
    });

    if (devices.length === 0) {
      console.log('⚠️ No devices registered for vehicle:', telemetryData.deviceId);
      
      telemetryLog.notificationSent = false;
      telemetryLog.notificationError = 'No devices registered';
      telemetryLog.processedAt = new Date();
      await telemetryLog.save();

      return res.status(200).json({
        success: true,
        message: 'Telemetry received but no devices registered for this vehicle',
        telemetryId: telemetryLog._id,
        deviceId: telemetryData.deviceId,
        event: telemetryData.event
      });
    }

    console.log(`📱 Found ${devices.length} device(s) for vehicle ${telemetryData.deviceId}`);

    // Get notification template for this event
    const template = getEventTemplate(telemetryData.event);
    
    // Prepare tokens
    const tokens = devices.map(d => d.token);

    // Prepare notification message
    const notificationMessage = {
      notification: {
        title: template.title,
        body: template.body,
      },
      data: {
        type: 'telemetry',
        event: telemetryData.event,
        deviceId: telemetryData.deviceId,
        timestamp: telemetryData.timestamp || new Date().toISOString(),
        payload: JSON.stringify(telemetryData),
        priority: template.priority
      },
      android: {
        priority: template.priority === 'critical' ? 'high' : 'normal',
        notification: {
          sound: template.sound,
          channelId: template.priority === 'critical' ? 'critical_alerts' : 'default'
        }
      },
      apns: {
        payload: {
          aps: {
            sound: template.sound,
            badge: 1
          }
        }
      },
      tokens: tokens
    };

    // Send push notifications
    let notificationResult = { success: false, successCount: 0, failureCount: tokens.length };
    
    if (firebaseInitialized) {
      const response = await admin.messaging().sendEachForMulticast(notificationMessage);
      
      console.log(`✅ Push notifications sent: ${response.successCount}/${tokens.length}`);
      
      notificationResult = {
        success: response.successCount > 0,
        successCount: response.successCount,
        failureCount: response.failureCount,
        totalDevices: tokens.length
      };

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
        
        console.log(`🗑️ Deactivated ${failedTokens.length} invalid token(s)`);
      }
    } else {
      console.log('⚠️ Firebase not initialized, skipping notification');
    }

    // Update telemetry log with notification status
    telemetryLog.notificationSent = notificationResult.success;
    telemetryLog.devicesNotified = notificationResult.successCount || 0;
    if (!notificationResult.success && notificationResult.failureCount === tokens.length) {
      telemetryLog.notificationError = 'All notifications failed';
    }
    telemetryLog.processedAt = new Date();
    await telemetryLog.save();

    console.log('✅ Telemetry processed successfully');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    res.status(200).json({
      success: true,
      message: 'Telemetry processed successfully',
      telemetryId: telemetryLog._id,
      deviceId: telemetryData.deviceId,
      event: telemetryData.event,
      notification: {
        sent: notificationResult.success,
        devicesNotified: notificationResult.successCount || 0,
        totalDevices: devices.length,
        title: template.title,
        body: template.body
      },
      recipients: devices.map(d => ({
        phoneNumber: d.phoneNumber,
        platform: d.deviceInfo?.platform
      }))
    });

  } catch (error) {
    console.error('❌ Error processing telemetry:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing telemetry',
      error: error.message
    });
  }
});

// Get telemetry logs - view history
app.get('/telemetry-logs', ensureMongoConnection, async (req, res) => {
  try {
    const { deviceId, event, limit = 50 } = req.query;

    const query = {};
    if (deviceId) query.deviceId = deviceId;
    if (event) query.event = event;

    const logs = await TelemetryLog.find(query)
      .sort({ receivedAt: -1 })
      .limit(parseInt(limit));

    res.status(200).json({
      success: true,
      count: logs.length,
      logs: logs
    });
  } catch (error) {
    console.error('❌ Error fetching telemetry logs:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching telemetry logs',
      error: error.message
    });
  }
});

// Webhook status - health check for telemetry
app.get('/webhook-status', ensureMongoConnection, async (req, res) => {
  try {
    const now = new Date();
    const last24Hours = new Date(now - 24 * 60 * 60 * 1000);

    const totalToday = await TelemetryLog.countDocuments({
      receivedAt: { $gte: last24Hours }
    });

    const lastWebhook = await TelemetryLog.findOne()
      .sort({ receivedAt: -1 })
      .limit(1);

    const recentEvents = await TelemetryLog.find()
      .sort({ receivedAt: -1 })
      .limit(10)
      .select('deviceId event timestamp notificationSent devicesNotified receivedAt');

    const eventStats = await TelemetryLog.aggregate([
      { $match: { receivedAt: { $gte: last24Hours } } },
      { $group: { _id: '$event', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    res.status(200).json({
      success: true,
      status: 'operational',
      lastWebhookReceived: lastWebhook?.receivedAt || null,
      totalWebhooksLast24Hours: totalToday,
      recentEvents: recentEvents,
      eventBreakdown: eventStats
    });
  } catch (error) {
    console.error('❌ Error fetching webhook status:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching webhook status',
      error: error.message
    });
  }
});

// Test telemetry endpoint - send yourself a test event
app.post('/test-telemetry', ensureMongoConnection, async (req, res) => {
  try {
    const { deviceId, event = 'TEST_EVENT' } = req.body;

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        message: 'deviceId is required'
      });
    }

    const testPayload = {
      deviceId,
      event,
      timestamp: new Date().toISOString(),
      test: true
    };

    // Call the telemetry endpoint internally
    const telemetryResponse = await axios.post(
      `${req.protocol}://${req.get('host')}/telemetry`,
      testPayload
    );

    res.status(200).json({
      success: true,
      message: 'Test telemetry sent',
      result: telemetryResponse.data
    });
  } catch (error) {
    console.error('❌ Error sending test telemetry:', error);
    res.status(500).json({
      success: false,
      message: 'Error sending test telemetry',
      error: error.message
    });
  }
});

// Check which devices are registered for a vehicle
app.post('/check-vehicle-devices', ensureMongoConnection, async (req, res) => {
  try {
    const { vehicleId } = req.body;

    if (!vehicleId) {
      return res.status(400).json({
        success: false,
        message: 'vehicleId is required'
      });
    }

    const devices = await DeviceToken.find({
      vehicleId: vehicleId,
      active: true
    });

    res.status(200).json({
      success: true,
      vehicleId,
      devicesFound: devices.length,
      devices: devices.map(d => ({
        deviceId: d._id,
        phoneNumber: d.phoneNumber,
        platform: d.deviceInfo?.platform,
        lastUsed: d.lastUsed,
        createdAt: d.createdAt
      }))
    });
  } catch (error) {
    res.status(500).json({
      success: false,
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
    const { 
      token, 
      deviceInfo, 
      phoneNumber,
      vehicleId,           // Display_Serial_Number
      registrationNumber,
      chassisNumber,
      userId 
    } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Device token is required'
      });
    }

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required to link device'
      });
    }

    // Normalize phone number
    const cleanPhone = normalizePhoneNumber(phoneNumber);

    // Optionally verify user exists in Master API
    // const userCheck = await checkUserExistsInAPI(cleanPhone);
    // if (!userCheck.exists) {
    //   return res.status(404).json({
    //     success: false,
    //     message: 'Phone number not registered'
    //   });
    // }

    // Upsert device token with vehicle identifiers
    const device = await DeviceToken.findOneAndUpdate(
      { token },
      {
        token,
        phoneNumber: cleanPhone,
        vehicleId,
        registrationNumber,
        chassisNumber,
        userId: userId || cleanPhone,
        deviceInfo,
        active: true,
        lastUsed: new Date()
      },
      { upsert: true, new: true }
    );

    console.log('📱 Device registered:', {
      deviceId: device._id,
      phone: cleanPhone,
      vehicleId: vehicleId || 'not provided',
      registration: registrationNumber || 'not provided'
    });

    res.status(200).json({
      success: true,
      message: 'Device registered successfully',
      deviceId: device._id,
      linkedTo: {
        phoneNumber: cleanPhone,
        vehicleId: vehicleId || null,
        registrationNumber: registrationNumber || null,
        chassisNumber: chassisNumber || null
      }
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
// const axios = require('axios');
// const crypto = require('crypto');

// const app = express();
// const PORT = process.env.PORT || 3000;

// // Middleware to parse JSON bodies
// app.use(bodyParser.json());
// app.use(bodyParser.urlencoded({ extended: true }));

// // MongoDB Connection
// const MONGODB_URI = 'mongodb+srv://sudhanshu_db_user:57noVDSClsUcZcnW@creataramongodb.g8c8bd1.mongodb.net/';

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

// // External API Configuration
// const MASTER_DATA_API =  'https://7sq2mm2c13.execute-api.ap-south-1.amazonaws.com/prod/masterdata';

// // Function to check if user exists in Master Data API
// async function checkUserExistsInAPI(phoneNumber) {
//   try {
//     console.log('🔍 Checking user in Master Data API:', phoneNumber);
    
//     const response = await axios.get(MASTER_DATA_API);
    
//     if (!response.data || !response.data.success || !response.data.vehicles) {
//       throw new Error('Invalid API response');
//     }

//     const vehicles = response.data.vehicles;
    
//     // Search for user by phone number
//     // Check both Phone_Number and CustomerMobile fields
//     const user = vehicles.find(vehicle => {
//       // Normalize all phone numbers for comparison (removes +91 for matching)
//       const searchPhone = phoneNumber.replace(/[^\d]/g, ''); // Remove all non-digits from search
//       const vehiclePhone = (vehicle.Phone_Number || '').replace(/[^\d]/g, '');
//       const customerMobile = (vehicle.CustomerMobile || '').replace(/[^\d]/g, '');
      
//       // Match last 10 digits (handles both +91XXXXXXXXXX and XXXXXXXXXX)
//       return vehiclePhone.slice(-10) === searchPhone.slice(-10) || 
//              customerMobile.slice(-10) === searchPhone.slice(-10);
//     });

//     if (user) {
//       console.log('✅ User found in Master Data API:', user.Name);
//       return {
//         exists: true,
//         user: {
//           phoneNumber: normalizePhoneNumber(user.Phone_Number || user.CustomerMobile),
//           name: user.Name,
//           email: user.Email,
//           registrationNumber: user.Registration_Number,
//           model: user.Model_Number,
//           address: user.Address,
//           city: user.City,
//           gender: user.Gender,
//           age: user.Age,
//           chassisNumber: user.ChassisNumber,
//           dateOfPurchase: user.Date_of_Purchase,
//           aadhaarNumber: user.Aadhaar_Number,
//           // Include full data if needed
//           fullData: user
//         }
//       };
//     } else {
//       console.log('❌ User not found in Master Data API:', phoneNumber);
//       return {
//         exists: false,
//         user: null
//       };
//     }
//   } catch (error) {
//     console.error('Error checking Master Data API:', error.message);
//     throw new Error('Failed to verify phone number');
//   }
// }

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

// // MSG91 Configuration
// const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY;
// const MSG91_TEMPLATE_ID = process.env.MSG91_TEMPLATE_ID;
// const MSG91_SENDER_ID = process.env.MSG91_SENDER_ID || 'OTPSMS';

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

// // OTP Schema - stores OTPs temporarily
// const otpSchema = new mongoose.Schema({
//   phoneNumber: {
//     type: String,
//     required: true,
//     index: true
//   },
//   otp: {
//     type: String,
//     required: true
//   },
//   purpose: {
//     type: String,
//     enum: ['login', 'signup', 'verification', 'password_reset'],
//     default: 'login'
//   },
//   verified: {
//     type: Boolean,
//     default: false
//   },
//   attempts: {
//     type: Number,
//     default: 0
//   },
//   expiresAt: {
//     type: Date,
//     required: true,
//     index: { expires: 0 } // TTL index - auto-delete after expiry
//   },
//   createdAt: {
//     type: Date,
//     default: Date.now
//   }
// });

// // Create Models
// const Webhook = mongoose.model('Webhook', webhookSchema);
// const DeviceToken = mongoose.model('DeviceToken', deviceTokenSchema);
// const OTP = mongoose.model('OTP', otpSchema);

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

// // Function to generate OTP
// function generateOTP(length = 4) {
//   const digits = '0123456789';
//   let otp = '';
//   for (let i = 0; i < length; i++) {
//     otp += digits[Math.floor(Math.random() * 10)];
//   }
//   return otp;
// }

// // Function to normalize phone number with +91 prefix
// function normalizePhoneNumber(phoneNumber) {
//   // Remove all non-digit characters except +
//   let cleaned = phoneNumber.replace(/[^\d+]/g, '');
  
//   // If it starts with +91, return as is
//   if (cleaned.startsWith('+91')) {
//     return cleaned;
//   }
  
//   // If it starts with 91 (without +), add the +
//   if (cleaned.startsWith('91') && cleaned.length === 12) {
//     return '+' + cleaned;
//   }
  
//   // If it's a 10-digit number, add +91
//   if (cleaned.length === 10) {
//     return '+91' + cleaned;
//   }
  
//   // If it starts with 0, remove it and add +91
//   if (cleaned.startsWith('0') && cleaned.length === 11) {
//     return '+91' + cleaned.substring(1);
//   }
  
//   // Return as is if already has + or doesn't match patterns
//   return cleaned;
// }

// // Function to send OTP via MSG91
// async function sendOTPViaMSG91(phoneNumber, otp) {
//   try {
//     if (!MSG91_AUTH_KEY || !MSG91_TEMPLATE_ID) {
//       throw new Error('MSG91 credentials not configured');
//     }

//     // Ensure phone number has +91 prefix
//     const formattedPhone = normalizePhoneNumber(phoneNumber);

//     // MSG91 OTP API endpoint with query parameters
//     const url = `https://control.msg91.com/api/v5/otp?template_id=${MSG91_TEMPLATE_ID}&mobile=${formattedPhone}&authkey=${MSG91_AUTH_KEY}`;

//     console.log(`📤 Sending OTP to ${formattedPhone} via MSG91`);

//     const response = await axios.post(url, {}, {
//       headers: {
//         'Content-Type': 'application/json'
//       }
//     });

//     console.log('✅ OTP sent via MSG91:', response.data);
    
//     return {
//       success: true,
//       messageId: response.data.request_id || response.data.type,
//       data: response.data
//     };
//   } catch (error) {
//     console.error('❌ MSG91 Error:', error.response?.data || error.message);
//     return {
//       success: false,
//       error: error.response?.data?.message || error.message
//     };
//   }
// }

// // Function to send push notification
// async function sendPushNotification(payload, webhookId) {
//   if (!firebaseInitialized) {
//     console.log('⚠️ Firebase not initialized, skipping notification');
//     return { success: false, reason: 'Firebase not configured' };
//   }

//   try {
//     const devices = await DeviceToken.find({ active: true });
    
//     if (devices.length === 0) {
//       console.log('⚠️ No devices registered for push notifications');
//       return { success: false, reason: 'No devices registered' };
//     }

//     const tokens = devices.map(d => d.token);

//     const message = {
//       notification: {
//         title: payload.title || 'New Webhook Received',
//         body: payload.message || JSON.stringify(payload).substring(0, 100),
//       },
//       data: {
//         webhookId: webhookId.toString(),
//         payload: JSON.stringify(payload),
//         timestamp: new Date().toISOString()
//       },
//       tokens: tokens
//     };

//     const response = await admin.messaging().sendEachForMulticast(message);
    
//     console.log(`✅ Push notifications sent: ${response.successCount}/${tokens.length}`);
    
//     if (response.failureCount > 0) {
//       const failedTokens = [];
//       response.responses.forEach((resp, idx) => {
//         if (!resp.success) {
//           failedTokens.push(tokens[idx]);
//           console.error(`Failed to send to token ${idx}:`, resp.error);
//         }
//       });
      
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

// // ==================== OTP ENDPOINTS ====================

// // Send OTP - Check user exists first
// app.post('/send-otp', ensureMongoConnection, async (req, res) => {
//   try {
//     const { phoneNumber, purpose = 'login' } = req.body;

//     // Validate phone number
//     if (!phoneNumber) {
//       return res.status(400).json({
//         success: false,
//         message: 'Phone number is required'
//       });
//     }

//     // Clean and normalize phone number with +91 prefix
//     const cleanPhone = normalizePhoneNumber(phoneNumber);

//     // Check if user exists in DynamoDB
//     const userCheck = await checkUserExistsInAPI(cleanPhone);

//     if (!userCheck.exists) {
//       return res.status(404).json({
//         success: false,
//         message: 'Phone number not registered',
//         error: 'USER_NOT_FOUND'
//       });
//     }

//     // Generate OTP (4 digits)
//     const otp = generateOTP(4);

//     // Save OTP to MongoDB (expires in 10 minutes)
//     const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    
//     // Delete any existing OTPs for this number
//     await OTP.deleteMany({ phoneNumber: cleanPhone });

//     const otpDoc = new OTP({
//       phoneNumber: cleanPhone,
//       otp: otp,
//       purpose: purpose,
//       expiresAt: expiresAt
//     });

//     await otpDoc.save();

//     // Send OTP via MSG91
//     const smsResult = await sendOTPViaMSG91(cleanPhone, otp);

//     if (!smsResult.success) {
//       return res.status(500).json({
//         success: false,
//         message: 'Failed to send OTP',
//         error: smsResult.error
//       });
//     }

//     console.log(`📱 OTP sent to ${cleanPhone}: ${otp}`);

//     res.status(200).json({
//       success: true,
//       message: 'OTP sent successfully',
//       phoneNumber: cleanPhone,
//       expiresIn: 600, // seconds
//       messageId: smsResult.messageId,
//       // Don't send OTP in production! Only for development
//       ...(process.env.NODE_ENV === 'development' && { otp: otp })
//     });

//   } catch (error) {
//     console.error('❌ Error sending OTP:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Error sending OTP',
//       error: error.message
//     });
//   }
// });

// // Verify OTP
// app.post('/verify-otp', ensureMongoConnection, async (req, res) => {
//   try {
//     const { phoneNumber, otp } = req.body;

//     if (!phoneNumber || !otp) {
//       return res.status(400).json({
//         success: false,
//         message: 'Phone number and OTP are required'
//       });
//     }

//     // Validate OTP is 4 digits
//     if (!/^\d{4}$/.test(otp)) {
//       return res.status(400).json({
//         success: false,
//         message: 'OTP must be 4 digits',
//         error: 'INVALID_OTP_FORMAT'
//       });
//     }

//     const cleanPhone = normalizePhoneNumber(phoneNumber);

//     // Find OTP in database
//     const otpDoc = await OTP.findOne({
//       phoneNumber: cleanPhone,
//       verified: false
//     }).sort({ createdAt: -1 });

//     if (!otpDoc) {
//       return res.status(404).json({
//         success: false,
//         message: 'No OTP found for this phone number',
//         error: 'OTP_NOT_FOUND'
//       });
//     }

//     // Check if OTP expired
//     if (new Date() > otpDoc.expiresAt) {
//       await OTP.deleteOne({ _id: otpDoc._id });
//       return res.status(400).json({
//         success: false,
//         message: 'OTP has expired',
//         error: 'OTP_EXPIRED'
//       });
//     }

//     // Check attempts
//     if (otpDoc.attempts >= 5) {
//       await OTP.deleteOne({ _id: otpDoc._id });
//       return res.status(429).json({
//         success: false,
//         message: 'Too many incorrect attempts',
//         error: 'MAX_ATTEMPTS_EXCEEDED'
//       });
//     }

//     // Verify OTP with MSG91
//     try {
//       const verifyUrl = `https://control.msg91.com/api/v5/otp/verify?otp=${otp}&mobile=${cleanPhone}`;
      
//       const msg91Response = await axios.get(verifyUrl, {
//         headers: {
//           'authkey': MSG91_AUTH_KEY
//         }
//       });

//       console.log('✅ MSG91 verification response:', msg91Response.data);

//       // Check if MSG91 verification was successful
//       if (msg91Response.data.type !== 'success') {
//         // Increment attempts in our database
//         otpDoc.attempts += 1;
//         await otpDoc.save();

//         return res.status(400).json({
//           success: false,
//           message: 'Invalid OTP',
//           error: 'INVALID_OTP',
//           attemptsRemaining: 5 - otpDoc.attempts
//         });
//       }

//     } catch (msg91Error) {
//       console.error('❌ MSG91 verification error:', msg91Error.response?.data || msg91Error.message);
      
//       // Increment attempts
//       otpDoc.attempts += 1;
//       await otpDoc.save();

//       return res.status(400).json({
//         success: false,
//         message: 'Invalid OTP or verification failed',
//         error: 'INVALID_OTP',
//         attemptsRemaining: 5 - otpDoc.attempts
//       });
//     }

//     // OTP is correct - mark as verified
//     otpDoc.verified = true;
//     await otpDoc.save();

//     // Get user details from DynamoDB
//     const userCheck = await checkUserExistsInAPI(cleanPhone);

//     // Generate session token (you can use JWT here)
//     const sessionToken = crypto.randomBytes(32).toString('hex');

//     console.log(`✅ OTP verified for ${cleanPhone}`);

//     res.status(200).json({
//       success: true,
//       message: 'OTP verified successfully',
//       phoneNumber: cleanPhone,
//       user: userCheck.user,
//       sessionToken: sessionToken
//     });

//   } catch (error) {
//     console.error('❌ Error verifying OTP:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Error verifying OTP',
//       error: error.message
//     });
//   }
// });

// // Resend OTP
// app.post('/resend-otp', ensureMongoConnection, async (req, res) => {
//   try {
//     const { phoneNumber } = req.body;

//     if (!phoneNumber) {
//       return res.status(400).json({
//         success: false,
//         message: 'Phone number is required'
//       });
//     }

//     const cleanPhone = normalizePhoneNumber(phoneNumber);

//     // Check if user exists in DynamoDB
//     const userCheck = await checkUserExistsInAPI(cleanPhone);

//     if (!userCheck.exists) {
//       return res.status(404).json({
//         success: false,
//         message: 'Phone number not registered',
//         error: 'USER_NOT_FOUND'
//       });
//     }

//     // Delete old OTPs from our database
//     await OTP.deleteMany({ phoneNumber: cleanPhone });

//     // Use MSG91 retry API to resend OTP
//     try {
//       const retryUrl = `https://control.msg91.com/api/v5/otp/retry?mobile=${cleanPhone}&authkey=${MSG91_AUTH_KEY}&retrytype=text`;
      
//       const msg91Response = await axios.get(retryUrl);

//       console.log('✅ MSG91 retry response:', msg91Response.data);

//       if (msg91Response.data.type !== 'success') {
//         return res.status(500).json({
//           success: false,
//           message: 'Failed to resend OTP',
//           error: msg91Response.data.message || 'MSG91 retry failed'
//         });
//       }

//       // Save new OTP record in our database for tracking
//       const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
//       const otpDoc = new OTP({
//         phoneNumber: cleanPhone,
//         otp: 'resent', // MSG91 handles the actual OTP
//         purpose: 'login',
//         expiresAt: expiresAt
//       });
//       await otpDoc.save();

//       res.status(200).json({
//         success: true,
//         message: 'OTP resent successfully',
//         phoneNumber: cleanPhone,
//         expiresIn: 600
//       });

//     } catch (msg91Error) {
//       console.error('❌ MSG91 retry error:', msg91Error.response?.data || msg91Error.message);
//       return res.status(500).json({
//         success: false,
//         message: 'Failed to resend OTP',
//         error: msg91Error.response?.data?.message || msg91Error.message
//       });
//     }

//   } catch (error) {
//     console.error('❌ Error resending OTP:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Error resending OTP',
//       error: error.message
//     });
//   }
// });

// // Check if phone number exists
// app.post('/check-phone', async (req, res) => {
//   try {
//     const { phoneNumber } = req.body;

//     if (!phoneNumber) {
//       return res.status(400).json({
//         success: false,
//         message: 'Phone number is required'
//       });
//     }

//     const cleanPhone = normalizePhoneNumber(phoneNumber);

//     const userCheck = await checkUserExistsInAPI(cleanPhone);

//     res.status(200).json({
//       success: true,
//       exists: userCheck.exists,
//       phoneNumber: cleanPhone
//     });

//   } catch (error) {
//     console.error('❌ Error checking phone:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Error checking phone number',
//       error: error.message
//     });
//   }
// });

// // ==================== EXISTING WEBHOOK ENDPOINTS ====================

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

//     const notificationResult = await sendPushNotification(
//       req.body,
//       webhookData._id
//     );

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

// // [Rest of existing webhook endpoints...]
// // (Keep all your existing webhook, device registration, and other endpoints)

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
//     },
//     msg91: {
//       configured: !!(MSG91_AUTH_KEY && MSG91_TEMPLATE_ID)
//     },
//     masterDataAPI: {
//       url: MASTER_DATA_API,
//       configured: true
//     }
//   });
// });

// // Start server (only in local development)
// if (process.env.NODE_ENV !== 'production') {
//   app.listen(PORT, () => {
//     console.log(`🚀 Webhook server running on port ${PORT}`);
//     console.log(`📍 Webhook URL: http://localhost:${PORT}/webhook`);
//     console.log(`📱 OTP URL: http://localhost:${PORT}/send-otp`);
//   });
// }

// // Export for Vercel serverless
// module.exports = app;
