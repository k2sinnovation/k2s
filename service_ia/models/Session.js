const mongoose = require('mongoose');
const crypto = require('crypto');

const sessionSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true,
    index: true 
  },
  
  deviceId: { 
    type: String, 
    required: true,
    index: true 
  },
  
  sessionToken: { 
    type: String, 
    required: true,
    unique: true,
    index: true
  },
  
  createdAt: { 
    type: Date, 
    default: Date.now,
    index: true 
  },
  
  expiresAt: { 
    type: Date,
    default: () => new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 an
    index: true
  },
  
  lastUsedAt: { 
    type: Date, 
    default: Date.now 
  },
  
  isActive: { 
    type: Boolean, 
    default: true,
    index: true 
  },
  
  deviceInfo: {
    platform: String,
    appVersion: String,
    osVersion: String
  },
  
  ipAddress: String
});

// Index composites pour performances
sessionSchema.index({ userId: 1, isActive: 1 });
sessionSchema.index({ sessionToken: 1, isActive: 1 });

// Méthode pour hasher le token
sessionSchema.statics.hashToken = function(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
};

// Méthode pour générer un token
sessionSchema.statics.generateToken = function() {
  return crypto.randomBytes(32).toString('hex');
};

module.exports = mongoose.models.Session || mongoose.model('Session', sessionSchema);
