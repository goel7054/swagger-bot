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

// Utility function to extract keywords from a question
function extractKeywords(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 2); // Ignore short/common words
}

// Improved search function with keyword matching
function searchSwagger(question, swagger, source) {
  const keywords = extractKeywords(question);
  const matches = [];

  for (const [pathKey, methods] of Object.entries(swagger.paths)) {
    for (const [method, details] of Object.entries(methods)) {
      const combinedText = `${method} ${pathKey} ${details.summary || ''} ${details.description || ''}`.toLowerCase();

      const isMatch = keywords.every(kw =>
        combinedText.includes(kw) || combinedText.includes(kw.slice(0, 5)) // Loose match
      );

      if (isMatch) {
        matches.push({
          source,
          method: method.toUpperCase(),
          path: pathKey,
          summary: details.summary,
          description: details.description,
        });
      }
    }
  }

  return matches;
}


// Endpoint to list available Swagger files
app.get('/swagger-sources', (req, res) => {
  res.json(Object.keys(allSwaggerDocs));
});

// Main chatbot endpoint
app.post('/api-doc-bot', (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: 'Missing question' });

  try {
    let totalMatches = [];

    for (const [source, swaggerDoc] of Object.entries(allSwaggerDocs)) {
      // Check for version question
      if (
        question.toLowerCase().includes('version') &&
        swaggerDoc.info &&
        swaggerDoc.info.version
      ) {
        totalMatches.push({
          source,
          method: 'INFO',
          path: '',
          summary: 'API Version',
          description: `Version: ${swaggerDoc.info.version}`,
        });
        continue;
      }

      const matches = searchSwagger(question, swaggerDoc, source);
      totalMatches = totalMatches.concat(matches);
    }

    if (totalMatches.length === 0) {
      return res.json({
        answer: `🤔 Sorry, I couldn't find anything related to "${question}".`,
      });
    }

    let response = `🔍 Found ${totalMatches.length} matching result(s):\n\n`;
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
