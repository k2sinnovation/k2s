const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true, 
    index: true 
  },
  flutterId: { type: String, required: true }, // ✅ CHANGÉ DE 'id' À 'flutterId'
  clientName: { type: String, required: true },
  clientPhone: String,
  clientEmail: String,
  dateTime: { type: Date, required: true, index: true },
  durationMinutes: { type: Number, required: true },
  prestationName: { type: String, required: true },
  prestationType: String,
  status: { 
    type: String, 
    enum: ['confirme', 'en_attente', 'annule'],
    default: 'en_attente'
  },
  notes: String,
  createdAt: { type: Date, default: Date.now }
});

// Index composite
appointmentSchema.index({ userId: 1, flutterId: 1 }, { unique: true });
appointmentSchema.index({ userId: 1, dateTime: 1 });

module.exports = mongoose.models.Appointment || mongoose.model('Appointment', appointmentSchema);
