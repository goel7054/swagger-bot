const express = require('express');
const cors = require('cors');
const YAML = require('yamljs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const swaggerFilePath = path.join(__dirname, 'api.yaml');

// Endpoint to load Swagger YAML
app.get('/swagger-info', (req, res) => {
  try {
    const swaggerDoc = YAML.load(swaggerFilePath);
    res.json(swaggerDoc);
  } catch (error) {
    console.error('Error loading Swagger YAML:', error.message);
    res.status(500).json({ error: 'Failed to load Swagger file' });
  }
});

// POST endpoint to handle questions about the API
app.post('/api-doc-bot', (req, res) => {
  const { question } = req.body;
  if (!question) {
    return res.status(400).json({ error: 'Missing question' });
  }

  try {
    const swaggerDoc = YAML.load(swaggerFilePath);
    
    // Dummy logic for now – you should replace this with actual AI logic
    const dummyAnswer = `You asked: "${question}". (This is a placeholder answer using Swagger doc title: "${swaggerDoc.info.title}")`;

    res.json({ answer: dummyAnswer });
  } catch (error) {
    console.error('Error in /api-doc-bot:', error.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server is running on http://localhost:${PORT}`);
});
