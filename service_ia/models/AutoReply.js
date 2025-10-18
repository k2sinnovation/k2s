const mongoose = require('mongoose');

const autoReplySchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true, 
    index: true 
  },
  
  messageId: { 
    type: String, 
    required: true, 
    index: true 
  },
  
  // ✅ NOUVEAU : Pour suivre les conversations Gmail/Outlook
  threadId: { 
    type: String, 
    index: true,
    sparse: true  // Permet les valeurs null sans erreur d'index
  },
  
  from: { 
    type: String, 
    required: true 
  },
  
  subject: String,
  
  body: { 
    type: String, 
    required: true 
  },
  
  analysis: {
    isRelevant: Boolean,
    confidence: Number,
    intent: String,
    reason: String
  },
  
  generatedResponse: String,
  sentResponse: String,
  
  status: { 
    type: String, 
    enum: ['analyzed', 'generated', 'pending', 'sent', 'rejected', 'ignored'],
    default: 'analyzed',
    index: true
  },
  
  sentAt: Date,
  
  createdAt: { 
    type: Date, 
    default: Date.now, 
    index: true 
  }
});

// ✅ Index composites optimisés
autoReplySchema.index({ userId: 1, status: 1 });
autoReplySchema.index({ userId: 1, createdAt: -1 });
autoReplySchema.index({ userId: 1, messageId: 1 }, { unique: true }); // Éviter les doublons
autoReplySchema.index({ userId: 1, threadId: 1 }); // ✅ NOUVEAU : Pour rechercher par conversation

module.exports = mongoose.models.AutoReply || mongoose.model('AutoReply', autoReplySchema);
