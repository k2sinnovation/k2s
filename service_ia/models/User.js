const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Vérifie si le modèle existe déjà
const User = mongoose.models.User || mongoose.model('User', new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  password: {
    type: String,
    required: true,
  },
  businessName: {
    type: String,
    required: true,
  },
  deviceId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  subscription: {
    type: String,
    enum: ['free', 'premium', 'enterprise'],
    default: 'free',
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  lastLoginAt: {
    type: Date,
    default: Date.now,
  },
}));

// Hash du mot de passe avant sauvegarde
User.schema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Méthode pour comparer les mots de passe
User.schema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = User;
