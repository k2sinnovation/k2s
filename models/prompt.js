const mongoose = require("mongoose");

const promptSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true, // ex: 'prompt_diagnostic', 'prompt_choix_technique', 'prompt_mistral_filter'
  },
  prompt_text: {
    type: String,
    required: true,
  },
});

module.exports = mongoose.model("Prompt", promptSchema);
