const express = require('express');
const cors = require('cors');
const yaml = require('yamljs');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Load all Swagger YAMLs from the "swagger" folder
const swaggerDir = path.join(__dirname, 'swagger');
const allSwaggerDocs = {}; // { apiName: swaggerDoc }

fs.readdirSync(swaggerDir).forEach(file => {
  if (file.endsWith('.yaml')) {
    const name = path.basename(file, '.yaml');
    try {
      const doc = yaml.load(path.join(swaggerDir, file));
      allSwaggerDocs[name] = doc;
      console.log(`✅ Loaded ${file}`);
    } catch (err) {
      console.error(`❌ Failed to load ${file}: ${err.message}`);
    }
  }
});

// Utility function to search one Swagger doc
function searchSwagger(question, swagger, source) {
  const lowerQ = question.toLowerCase();
  const matches = [];

  for (const [path, methods] of Object.entries(swagger.paths)) {
    for (const [method, details] of Object.entries(methods)) {
      const combinedText = `${method} ${path} ${details.summary || ''} ${details.description || ''}`.toLowerCase();
      if (combinedText.includes(lowerQ)) {
        matches.push({
          source,
          method: method.toUpperCase(),
          path,
          summary: details.summary,
          description: details.description,
        });
      }
    }
  }

  return matches;
}

// API to get all Swagger sources (optional)
app.get('/swagger-sources', (req, res) => {
  res.json(Object.keys(allSwaggerDocs));
});

// Chat-style question answering over multiple Swagger docs
app.post('/api-doc-bot', (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: 'Missing question' });

  try {
    let totalMatches = [];

    for (const [source, swaggerDoc] of Object.entries(allSwaggerDocs)) {
      const matches = searchSwagger(question, swaggerDoc, source);
      totalMatches = totalMatches.concat(matches);
    }

    if (totalMatches.length === 0) {
      return res.json({
        answer: `🤔 Sorry, I couldn't find anything related to "${question}".`,
      });
    }

    let response = `🔍 Found ${totalMatches.length} matching endpoint(s):\n\n`;
    totalMatches.forEach((m, i) => {
      response += `${i + 1}. 📘 **[${m.source}]** [${m.method}] \`${m.path}\`\n   - ${m.summary}\n   - ${m.description}\n\n`;
    });

    res.json({ answer: response });
  } catch (err) {
    console.error('Error in /api-doc-bot:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Multi-Swagger Bot running at http://localhost:${PORT}`);
});
