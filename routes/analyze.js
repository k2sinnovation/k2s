const express = require("express");
const router = express.Router();
const { analyzeRequest } = require("../controllers/analyzeController");

router.post("/", analyzeRequest);

module.exports = router;
