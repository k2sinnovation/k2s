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
  
  // ✅ Pour suivre les conversations Gmail/Outlook
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
    enum: ['analyzed', 'generated', 'pending', 'sent', 'rejected', 'ignored', 'processing'], // ✅ AJOUT 'processing'
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

// ✅ Index uniques et de performance pour éviter les doublons et accélérer les requêtes
AutoReplySchema.index({ userId: 1, messageId: 1 }, { unique: true });   // Anti-doublon
AutoReplySchema.index({ userId: 1, status: 1 });                         // Par status
AutoReplySchema.index({ userId: 1, createdAt: -1 });                     // Historique
AutoReplySchema.index({ userId: 1, threadId: 1, status: 1 });            // Thread + status
AutoReplySchema.index({ userId: 1, threadId: 1, sentAt: -1 });           // Dernière réponse thread

module.exports = mongoose.models.AutoReply || mongoose.model('AutoReply', autoReplySchema);
