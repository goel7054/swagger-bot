const express = require("express");
const fs = require("fs");
const path = require("path");
const YAML = require("yaml");
const Fuse = require("fuse.js");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

// === Load all YAML files ===
const swaggerDir = path.join(__dirname);
const swaggerFiles = fs.readdirSync(swaggerDir).filter(f => f.endsWith('.yaml'));

const apiEntries = [];

for (const fileName of swaggerFiles) {
  const filePath = path.join(swaggerDir, fileName);
  const fileContent = fs.readFileSync(filePath, "utf8");
  const doc = YAML.parse(fileContent);

  if (!doc.paths) continue;

  for (const pathKey in doc.paths) {
    const methods = doc.paths[pathKey];
    for (const method in methods) {
      const details = methods[method];

      const parameters = (details.parameters || []).map(p => `${p.name || ""} ${p.description || ""}`).join(" ");
      const tags = (details.tags || []).join(" ");
      
      apiEntries.push({
        method: method.toUpperCase(),
        path: pathKey,
        summary: details.summary || "",
        description: details.description || "",
        operationId: details.operationId || "",
        tags,
        parameters,
        sourceFile: fileName,
      });
    }
  }
}

// === Setup Fuse.js for fuzzy search ===
const fuse = new Fuse(apiEntries, {
  keys: [
    "summary",
    "description",
    "path",
    "method",
    "operationId",
    "tags",
    "parameters"
  ],
  threshold: 0.4,
  includeScore: true,
});

// === Search API ===
app.post("/search", (req, res) => {
  const { query } = req.body;

  if (!query || typeof query !== "string") {
    return res.status(400).json({ error: "Query string is required." });
  }

  const results = fuse.search(query).slice(0, 5); // top 5

  if (results.length === 0) {
    return res.json({ message: "No matching API endpoint found." });
  }

  const matched = results.map((result) => ({
    path: result.item.path,
    method: result.item.method,
    summary: result.item.summary,
    description: result.item.description,
    operationId: result.item.operationId,
    tags: result.item.tags,
    source: result.item.sourceFile,
    score: result.score.toFixed(2),
  }));

  return res.json({ matches: matched });
});

// === Health check ===
app.get("/", (req, res) => {
  res.send("Multi-Swagger API Documentation Bot is up and running!");
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
