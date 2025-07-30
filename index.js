const express = require('express');
const cors = require('cors');
const YAML = require('yamljs');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const swaggerFilePath = path.join(__dirname, 'api.yaml');

// Endpoint to send entire Swagger JSON
app.get('/swagger-info', (req, res) => {
  try {
    const swaggerDoc = YAML.load(swaggerFilePath);
    res.json(swaggerDoc);
  } catch (error) {
    console.error('Error loading Swagger YAML:', error.message);
    res.status(500).json({ error: 'Failed to load Swagger file' });
  }
});

// Dummy /ask endpoint to simulate Q&A (replace with real AI logic later)
app.post('/ask', (req, res) => {
  const question = req.body.question;
  const swaggerDoc = YAML.load(swaggerFilePath);

  // Simple keyword search as placeholder logic
  const paths = Object.keys(swaggerDoc.paths || {});
  const matches = paths.filter(p => p.toLowerCase().includes(question.toLowerCase()));

  if (matches.length > 0) {
    res.json({ answer: `This API might help you: ${matches[0]}` });
  } else {
    res.json({ answer: `Sorry, no relevant API found for: "${question}"` });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server is running on http://localhost:${PORT}`);
});
