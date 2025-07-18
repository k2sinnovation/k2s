const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true, // device ID ou Google ID
  },
  subscription_level: {
    type: String,
    enum: ["basic", "premium", "elite"],
    default: "basic",
  },
  last_analysis_date: {
    type: Date,
    default: null,
  },
  analysis_count: {
    type: Number,
    default: 0,
  },
});

module.exports = mongoose.model("User", userSchema);
