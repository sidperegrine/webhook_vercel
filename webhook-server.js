const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// MongoDB Connection
const MONGODB_URI = "mongodb+srv://sudhanshu_db_user:57noVDSClsUcZcnW@creataramongodb.g8c8bd1.mongodb.net/";

mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

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
  url: String
});

// Create Webhook Model
const Webhook = mongoose.model('Webhook', webhookSchema);

// Webhook endpoint - POST
app.post('/webhook', async (req, res) => {
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

    res.status(200).json({
      success: true,
      message: 'Webhook received successfully',
      id: webhookData._id,
      timestamp: webhookData.timestamp,
      receivedData: webhookData.payload,
      savedTo: 'MongoDB'
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
app.get('/webhook', async (req, res) => {
  try {
    const webhookData = new Webhook({
      payload: req.query,
      headers: req.headers,
      method: req.method,
      sourceIp: req.ip,
      url: req.originalUrl
    });

    await webhookData.save();
    
    res.status(200).json({
      success: true,
      message: 'Webhook GET request received',
      id: webhookData._id,
      timestamp: webhookData.timestamp,
      receivedData: webhookData.payload,
      savedTo: 'MongoDB'
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

// Get all webhooks
app.get('/webhooks', async (req, res) => {
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
app.get('/webhooks/:id', async (req, res) => {
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
app.delete('/webhooks', async (req, res) => {
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
  res.status(200).json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Webhook server running on port ${PORT}`);
  console.log(`📍 Webhook URL: http://localhost:${PORT}/webhook`);
  console.log(`📊 View all webhooks: http://localhost:${PORT}/webhooks`);
});

module.exports = app;
