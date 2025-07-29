
const express = require("express");
const fs = require("fs");
const cors = require("cors");
const yaml = require("js-yaml");
const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Load Swagger YAML once and parse
const swaggerFile = "./swagger.yaml";
let swaggerData = {};

try {
  const fileContents = fs.readFileSync(swaggerFile, "utf8");
  swaggerData = yaml.load(fileContents);
} catch (e) {
  console.error("Error loading swagger file:", e);
}

app.post("/query", (req, res) => {
  const question = req.body.question.toLowerCase();
  const paths = swaggerData.paths;
  let result = [];

  for (let path in paths) {
    for (let method in paths[path]) {
      const operation = paths[path][method];
      if (
        (operation.summary && operation.summary.toLowerCase().includes(question)) ||
        (operation.description && operation.description.toLowerCase().includes(question))
      ) {
        result.push({
          path,
          method,
          summary: operation.summary || "",
          description: operation.description || "",
        });
      }
    }
  }

  res.json({ matches: result });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
