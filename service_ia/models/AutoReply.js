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
// 1️⃣ ANTI-DOUBLON : Empêche de traiter 2 fois le même message
autoReplySchema.index({ userId: 1, messageId: 1 }, { unique: true });
// 2️⃣ RECHERCHE PAR STATUS : Trouver pending/sent/ignored rapidement
autoReplySchema.index({ userId: 1, status: 1 });
// 3️⃣ HISTORIQUE CHRONOLOGIQUE : Afficher l'historique trié par date
autoReplySchema.index({ userId: 1, createdAt: -1 });
// 4️⃣ DÉTECTION THREAD RÉPONDU : Vérifier si on a déjà répondu dans une conversation
//    Cet index couvre aussi les requêtes { userId, threadId } grâce au left-prefix
autoReplySchema.index({ userId: 1, threadId: 1, status: 1 });
// 5️⃣ DERNIÈRE RÉPONSE D'UN THREAD : Trouver la réponse la plus récente d'une conversation
autoReplySchema.index({ userId: 1, threadId: 1, sentAt: -1 });

module.exports = mongoose.models.AutoReply || mongoose.model('AutoReply', autoReplySchema);
