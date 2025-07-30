const express = require("express");
const fs = require("fs");
const YAML = require("yaml");
const Fuse = require("fuse.js");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

// Load and parse OpenAPI YAML
const file = fs.readFileSync("./user.yaml", "utf8");
const doc = YAML.parse(file);

// Preprocess API paths into searchable entries
const apiEntries = [];

for (const path in doc.paths) {
  const methods = doc.paths[path];
  for (const method in methods) {
    const details = methods[method];
    apiEntries.push({
      method: method.toUpperCase(),
      path,
      summary: details.summary || "",
      description: details.description || "",
    });
  }
}

// Fuse.js setup for fuzzy search
const fuse = new Fuse(apiEntries, {
  keys: ["summary", "description", "path", "method"],
  threshold: 0.4, // Lower = stricter; adjust as needed
  includeScore: true,
});

app.post("/search", (req, res) => {
  const { query } = req.body;

  if (!query || typeof query !== "string") {
    return res.status(400).json({ error: "Query string is required." });
  }

  const results = fuse.search(query).slice(0, 5); // top 5 matches

  if (results.length === 0) {
    return res.json({ message: "No matching API endpoint found." });
  }

  const matched = results.map((result) => ({
    path: result.item.path,
    method: result.item.method,
    summary: result.item.summary,
    description: result.item.description,
    score: result.score.toFixed(2),
  }));

  return res.json({ matches: matched });
});

// Health check
app.get("/", (req, res) => {
  res.send("API Documentation Bot is up and running!");
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
