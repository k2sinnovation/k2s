const mongoose = require('mongoose');

const emailAccountSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  provider: {
    type: String,
    required: true,
    enum: ['gmail', 'outlook'],
  },
  email: {
    type: String,
    required: true,
  },
  accessToken: {
    type: String,
    required: true,
  },
  refreshToken: {
    type: String,
    required: true,
  },
  tokenExpiresAt: {
    type: Date,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  // Configuration IA par compte
  aiSettings: {
    autoReply: {
      type: Boolean,
      default: true,
    },
    replyDelay: {
      type: Number,
      default: 5, // minutes
    },
    workingHours: {
      enabled: {
        type: Boolean,
        default: false,
      },
      start: {
        type: String,
        default: '09:00',
      },
      end: {
        type: String,
        default: '18:00',
      },
    },
    customInstructions: {
      type: String,
      default: '',
    },
  },
  lastCheckedAt: {
    type: Date,
    default: Date.now,
  },
  // Statistiques
  stats: {
    totalEmailsReceived: {
      type: Number,
      default: 0,
    },
    totalRepliesSent: {
      type: Number,
      default: 0,
    },
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Index composé pour éviter les doublons
emailAccountSchema.index({ userId: 1, provider: 1, email: 1 }, { unique: true });

module.exports = mongoose.model('EmailAccount', emailAccountSchema);
