const mongoose = require('mongoose');

const prestationSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true, 
    index: true 
  },
  flutterId: { type: String, required: true }, // ✅ CHANGÉ DE 'id' À 'flutterId'
  name: { type: String, required: true },
  category: { type: String, required: true },
  defaultDurationMinutes: { type: Number, required: true },
  defaultPrice: { type: Number, required: true },
  colorCode: String,
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

// Index composite pour recherche efficace
prestationSchema.index({ userId: 1, flutterId: 1 }, { unique: true });

module.exports = mongoose.models.Prestation || mongoose.model('Prestation', prestationSchema);
