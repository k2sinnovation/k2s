const fs = require("fs");
const path = require("path");

async function loadPrompt(name) {
  const filePath = path.join(__dirname, "../prompts", `${name}.txt`);
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, "utf8", (err, data) => {
      if (err) return reject(err);
      resolve(data);
    });
  });
}

module.exports = { loadPrompt };
