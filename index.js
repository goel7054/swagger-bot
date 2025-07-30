const express = require('express');
const cors = require('cors');
const YAML = require('yamljs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const swaggerFilePath = path.join(__dirname, 'api.yaml');

// Load YAML once at startup
let swaggerDoc = {};
try {
  swaggerDoc = YAML.load(swaggerFilePath);
  console.log('✅ Swagger YAML loaded successfully');
} catch (error) {
  console.error('❌ Failed to load Swagger YAML:', error.message);
}

// Simple helper to search API paths
function searchSwagger(question) {
  const lowerQ = question.toLowerCase();
  const matches = [];

  if (!swaggerDoc.paths) return matches;

  Object.entries(swaggerDoc.paths).forEach(([path, methods]) => {
    Object.entries(methods).forEach(([method, details]) => {
      const summary = details.summary || '';
      const description = details.description || '';
      const combined = `${method.toUpperCase()} ${path} ${summary} ${description}`.toLowerCase();

      if (combined.includes(lowerQ)) {
        matches.push({
          method: method.toUpperCase(),
          path,
          summary: details.summary || '',
          description: details.description || ''
        });
      }
    });
  });

  return matches;
}

// Endpoint for API Q&A
app.post('/api-doc-bot', (req, res) => {
  const { question } = req.body;
  if (!question) {
    return res.status(400).json({ error: 'Missing question' });
  }

  try {
    const results = searchSwagger(question);

    if (results.length === 0) {
      return res.json({
        answer: `🤖 Sorry, I couldn't find anything related to "${question}" in the API documentation.`
      });
    }

    const formatted = results.map(r =>
      `🔹 **${r.method} ${r.path}**\n${r.summary || r.description || 'No description provided.'}`
    ).join('\n\n');

    return res.json({ answer: formatted });
  } catch (error) {
    console.error('Error in /api-doc-bot:', error.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
