const mongoose = require('mongoose');

// ✅ Configuration des quotas par plan d'abonnement
const QUOTA_PLANS = {
  free: {
    dailyTokens: 10000,
    monthlyCalls: 100,
    maxEmailsPerDay: 20,
    name: 'Gratuit'
  },
  basic: {
    dailyTokens: 50000,
    monthlyCalls: 1000,
    maxEmailsPerDay: 100,
    name: 'Basic'
  },
  premium: {
    dailyTokens: 200000,
    monthlyCalls: 5000,
    maxEmailsPerDay: 500,
    name: 'Premium'
  },
  enterprise: {
    dailyTokens: 1000000,
    monthlyCalls: -1,
    maxEmailsPerDay: -1,
    name: 'Enterprise'
  }
};

const userQuotaSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  
  currentPlan: {
    type: String,
    enum: ['free', 'basic', 'premium', 'enterprise'],
    default: 'free'
  },
  
  dailyTokenLimit: {
    type: Number,
    default: 10000
  },
  
  tokensUsedToday: {
    type: Number,
    default: 0
  },
  
  monthlyCallsLimit: {
    type: Number,
    default: 100
  },
  
  callsUsedThisMonth: {
    type: Number,
    default: 0
  },
  
  emailsSentToday: {
    type: Number,
    default: 0
  },
  
  maxEmailsPerDay: {
    type: Number,
    default: 20
  },
  
  lastResetDate: {
    type: Date,
    default: () => {
      const now = new Date();
      now.setUTCHours(0, 0, 0, 0);
      return now;
    }
  },
  
  lastMonthlyResetDate: {
    type: Date,
    default: () => {
      const now = new Date();
      return new Date(now.getUTCFullYear(), now.getUTCMonth(), 1);
    }
  },
  
  history: [{
    date: Date,
    tokensUsed: Number,
    callsMade: Number,
    emailsSent: Number
  }],
  
  isBlocked: {
    type: Boolean,
    default: false
  },
  
  blockedUntil: Date,
  
  blockedReason: {
    type: String,
    enum: ['tokens', 'calls', 'emails', 'expired_subscription', null]
  },
  
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// ✅ MÉTHODE ULTRA-ROBUSTE : Synchroniser avec le plan
userQuotaSchema.methods.syncWithUserPlan = async function() {
  try {
    const User = mongoose.model('User');
    
    // ✅ Utiliser lean() pour éviter les problèmes Mongoose
    const user = await User.findById(this.userId)
      .select('subscription createdAt')
      .lean()
      .exec();
    
    if (!user) {
      console.warn(`⚠️ [Quota] User ${this.userId} non trouvé, défaut à free`);
      this.currentPlan = 'free';
      this._applyPlanLimits('free', null);
      return this;
    }
    
    // ✅ GESTION ROBUSTE DES 3 CAS
    let userPlan = 'free';
    let isActive = true;
    let endDate = null;
    let customQuotas = null;
    
    // CAS 1 : Pas de subscription
    if (!user.subscription) {
      console.warn(`⚠️ [Quota] User ${this.userId} sans subscription`);
      userPlan = 'free';
    }
    // CAS 2 : Ancien format string
    else if (typeof user.subscription === 'string') {
      console.warn(`⚠️ [Quota] User ${this.userId} a subscription string: "${user.subscription}"`);
      userPlan = ['free', 'basic', 'premium', 'enterprise'].includes(user.subscription) 
        ? user.subscription 
        : 'free';
    }
    // CAS 3 : Nouveau format objet
    else if (typeof user.subscription === 'object') {
      userPlan = user.subscription.plan || 'free';
      isActive = user.subscription.isActive !== false;
      endDate = user.subscription.endDate;
      customQuotas = user.subscription.customQuotas;
    }
    
    // Validation du plan
    if (!['free', 'basic', 'premium', 'enterprise'].includes(userPlan)) {
      console.warn(`⚠️ [Quota] Plan invalide "${userPlan}", défaut à free`);
      userPlan = 'free';
    }
    
    // Vérifier expiration
    if (!isActive || (endDate && new Date(endDate) < new Date())) {
      console.warn(`⚠️ [Quota] Abonnement expiré pour user ${this.userId}`);
      this.currentPlan = 'free';
      this.isBlocked = true;
      this.blockedReason = 'expired_subscription';
      this._applyPlanLimits('free', null);
      return this;
    }
    
    // Mise à jour du plan si changement
    if (this.currentPlan !== userPlan) {
      console.log(`🔄 [Quota] ${this.userId}: ${this.currentPlan} → ${userPlan}`);
      this.currentPlan = userPlan;
      this._applyPlanLimits(userPlan, customQuotas);
    }
    
    return this;
    
  } catch (error) {
    console.error(`❌ [Quota] Erreur syncWithUserPlan:`, error);
    // En cas d'erreur, on garde le plan actuel
    return this;
  }
};

// ✅ MÉTHODE PRIVÉE : Appliquer les limites d'un plan
userQuotaSchema.methods._applyPlanLimits = function(plan, customQuotas) {
  const planConfig = QUOTA_PLANS[plan] || QUOTA_PLANS.free;
  
  this.dailyTokenLimit = customQuotas?.dailyTokens || planConfig.dailyTokens;
  this.monthlyCallsLimit = customQuotas?.monthlyCalls || planConfig.monthlyCalls;
  this.maxEmailsPerDay = customQuotas?.maxEmailsPerDay || planConfig.maxEmailsPerDay;
  
  console.log(`✅ [Quota] Limites appliquées: ${this.dailyTokenLimit} tokens/jour, ${this.maxEmailsPerDay} emails/jour`);
};

// ✅ MÉTHODE : Vérifier et réinitialiser les quotas quotidiens
userQuotaSchema.methods.checkAndReset = function() {
  const now = new Date();
  const midnightToday = new Date(now);
  midnightToday.setUTCHours(0, 0, 0, 0);
  
  // Reset quotidien
  if (this.lastResetDate < midnightToday) {
    if (this.tokensUsedToday > 0 || this.emailsSentToday > 0) {
      this.history.push({
        date: this.lastResetDate,
        tokensUsed: this.tokensUsedToday,
        callsMade: 0,
        emailsSent: this.emailsSentToday
      });
      
      if (this.history.length > 30) {
        this.history = this.history.slice(-30);
      }
    }
    
    this.tokensUsedToday = 0;
    this.emailsSentToday = 0;
    this.isBlocked = false;
    this.blockedUntil = null;
    this.blockedReason = null;
    this.lastResetDate = midnightToday;
    
    console.log(`📅 [Quota] Reset quotidien pour user ${this.userId}`);
  }
  
  // Reset mensuel
  const firstDayThisMonth = new Date(now.getUTCFullYear(), now.getUTCMonth(), 1);
  if (this.lastMonthlyResetDate < firstDayThisMonth) {
    this.callsUsedThisMonth = 0;
    this.lastMonthlyResetDate = firstDayThisMonth;
    console.log(`📅 [Quota] Reset mensuel pour user ${this.userId}`);
  }
  
  return this;
};

// ✅ MÉTHODE : Utiliser des tokens
userQuotaSchema.methods.useTokens = function(amount) {
  this.checkAndReset();
  
  // Enterprise = illimité
  if (this.currentPlan === 'enterprise') {
    this.tokensUsedToday += amount;
    this.updatedAt = new Date();
    return {
      success: true,
      remaining: -1,
      blocked: false,
      plan: this.currentPlan,
      message: `${amount} tokens utilisés (plan Enterprise - illimité)`
    };
  }
  
  const remaining = this.dailyTokenLimit - this.tokensUsedToday;
  
  if (remaining < amount) {
    this.isBlocked = true;
    this.blockedReason = 'tokens';
    
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    this.blockedUntil = tomorrow;
    
    console.warn(`⚠️ [Quota] User ${this.userId} (${this.currentPlan}) bloqué - tokens insuffisants`);
    
    return {
      success: false,
      remaining: 0,
      blocked: true,
      blockedUntil: this.blockedUntil,
      plan: this.currentPlan,
      message: `Quota quotidien dépassé (${this.currentPlan}). Réinitialisation à minuit.`
    };
  }
  
  this.tokensUsedToday += amount;
  this.updatedAt = new Date();
  
  const newRemaining = this.dailyTokenLimit - this.tokensUsedToday;
  
  return {
    success: true,
    remaining: newRemaining,
    blocked: false,
    plan: this.currentPlan,
    message: `${amount} tokens utilisés. ${newRemaining} restants.`
  };
};

// ✅ MÉTHODE : Incrémenter compteur d'emails
userQuotaSchema.methods.incrementEmailsSent = function() {
  this.checkAndReset();
  
  if (this.currentPlan === 'enterprise' || this.maxEmailsPerDay === -1) {
    this.emailsSentToday++;
    return { success: true, remaining: -1 };
  }
  
  if (this.emailsSentToday >= this.maxEmailsPerDay) {
    this.isBlocked = true;
    this.blockedReason = 'emails';
    
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    this.blockedUntil = tomorrow;
    
    return {
      success: false,
      remaining: 0,
      blocked: true,
      message: `Limite d'emails quotidiens atteinte (${this.maxEmailsPerDay})`
    };
  }
  
  this.emailsSentToday++;
  return {
    success: true,
    remaining: this.maxEmailsPerDay - this.emailsSentToday
  };
};

// ✅ MÉTHODE : Incrémenter compteur d'appels API
userQuotaSchema.methods.incrementAPICalls = function() {
  if (this.currentPlan === 'enterprise' || this.monthlyCallsLimit === -1) {
    this.callsUsedThisMonth++;
    return { success: true, remaining: -1 };
  }
  
  if (this.callsUsedThisMonth >= this.monthlyCallsLimit) {
    this.isBlocked = true;
    this.blockedReason = 'calls';
    
    const nextMonth = new Date();
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1, 1);
    nextMonth.setUTCHours(0, 0, 0, 0);
    this.blockedUntil = nextMonth;
    
    return {
      success: false,
      remaining: 0,
      blocked: true,
      message: `Limite mensuelle d'appels atteinte (${this.monthlyCallsLimit})`
    };
  }
  
  this.callsUsedThisMonth++;
  return {
    success: true,
    remaining: this.monthlyCallsLimit - this.callsUsedThisMonth
  };
};

userQuotaSchema.statics.QUOTA_PLANS = QUOTA_PLANS;

module.exports = mongoose.model('UserQuota', userQuotaSchema);
