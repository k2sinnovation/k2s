const mongoose = require('mongoose');

const prestationSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true, 
    index: true 
  },
  id: { type: String }, // ✅ RETIRÉ 'required: true'
  name: { type: String, required: true },
  category: { type: String, required: true },
  defaultDurationMinutes: { type: Number, required: true },
  defaultPrice: { type: Number, required: true },
  colorCode: String,
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

// Index composite pour recherche efficace
prestationSchema.index({ userId: 1, id: 1 });

module.exports = mongoose.models.Prestation || mongoose.model('Prestation', prestationSchema);
