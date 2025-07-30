const express = require('express');
const cors = require('cors');
const YAML = require('yamljs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const swaggerFilePath = path.join(__dirname, 'api.yaml');

// Load Swagger YAML once on startup
let swaggerDoc;
try {
  swaggerDoc = YAML.load(swaggerFilePath);
  console.log('✅ Swagger YAML loaded successfully');
} catch (error) {
  console.error('❌ Error loading Swagger YAML:', error.message);
}

// Utility function to search API docs
function searchSwagger(question, swagger) {
  const lowerQ = question.toLowerCase();
  const matches = [];

  for (const [path, methods] of Object.entries(swagger.paths)) {
    for (const [method, details] of Object.entries(methods)) {
      const combinedText = `${method} ${path} ${details.summary || ''} ${details.description || ''}`.toLowerCase();
      if (combinedText.includes(lowerQ)) {
        matches.push({
          method: method.toUpperCase(),
          path,
          summary: details.summary,
          description: details.description,
        });
      }
    }
  }

  if (matches.length === 0) {
    return `🤔 Sorry, I couldn't find anything related to "${question}".`;
  }

  let response = `🔍 Found ${matches.length} matching endpoint(s):\n\n`;
  matches.forEach((m, i) => {
    response += `${i + 1}. **[${m.method}]** \`${m.path}\`\n   - ${m.summary}\n   - ${m.description}\n\n`;
  });

  return response;
}

// Endpoint to return full Swagger YAML as JSON
app.get('/swagger-info', (req, res) => {
  if (!swaggerDoc) {
    return res.status(500).json({ error: 'Swagger not loaded' });
  }
  res.json(swaggerDoc);
});

// Chat-style API question answering
app.post('/api-doc-bot', (req, res) => {
  const { question } = req.body;
  if (!question) {
    return res.status(400).json({ error: 'Missing question' });
  }

  try {
    const answer = searchSwagger(question, swaggerDoc);
    res.json({ answer });
  } catch (error) {
    console.error('Error in /api-doc-bot:', error.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
