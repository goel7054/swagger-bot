// index.js
require("dotenv").config(); // no-op on Render, useful locally

const express = require("express");
const fs = require("fs");
const path = require("path");
const YAML = require("yaml");
const Fuse = require("fuse.js");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

// ---------- Hugging Face config ----------
const HF_API_KEY = process.env.HF_API_KEY || "";
const HF_MODEL = process.env.HF_MODEL || "openai-community/gpt2"; // primary model
const FALLBACK_MODEL = process.env.FALLBACK_MODEL || "google/flan-t5-small"; // fallback model
const HF_TASK = process.env.HF_TASK || "text2text-generation"; // task type

// Helper: call Hugging Face Inference API with fallback
async function callHuggingFace(prompt) {
  if (!HF_API_KEY) {
    return "Hugging Face API key is not configured. Please set HF_API_KEY.";
  }

  async function query(model) {
    const url = `https://api-inference.huggingface.co/models/${model}`;
    const { data } = await axios.post(
      url,
      { inputs: prompt },
      {
        headers: {
          Authorization: `Bearer ${HF_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    if (Array.isArray(data) && data.length) {
      const first = data[0];
      return (
        first.generated_text ||
        first.summary_text ||
        first.translation_text ||
        first.output_text ||
        JSON.stringify(first)
      );
    }
    return typeof data === "string" ? data : JSON.stringify(data);
  }

  try {
    const result = await query(HF_MODEL);
    return `(${HF_MODEL}) → ${result}`;
  } catch (err) {
    console.error(`HF error with model ${HF_MODEL}:`, err.response?.data || err.message);
    console.log(`⚠️ Falling back to ${FALLBACK_MODEL}...`);
    try {
      const fallbackResult = await query(FALLBACK_MODEL);
      return `(${FALLBACK_MODEL}) → ${fallbackResult}`;
    } catch (err2) {
      console.error(`HF fallback error:`, err2.response?.data || err2.message);
      return "AI service unavailable right now.";
    }
  }
}

// Utility: detect if the user asked a question
function isQuestion(q) {
  const s = q.trim().toLowerCase();
  if (s.endsWith("?")) return true;
  const starters = ["how", "what", "where", "when", "why", "can", "does", "do", "is", "are", "should", "could", "explain"];
  return starters.some(w => s.startsWith(w + " "));
}

// Utility: build context from Fuse results + metadata with a char budget
function buildContext({ results = [], limitChars = 3500, includeMeta = "" }) {
  const lines = [];
  if (includeMeta) lines.push(includeMeta);

  for (const r of results) {
    const it = r.item;
    lines.push(
      `[${it.method}] ${it.path} (${it.sourceFile})\n` +
      `summary: ${it.summary || "-"}\n` +
      `desc: ${it.description || "-"}\n` +
      `operationId: ${it.operationId || "-"}\n` +
      `tags: ${it.tags || "-"}\n` +
      `params: ${it.parameters || "-"}\n`
    );
  }

  let ctx = "";
  for (const block of lines) {
    if ((ctx + "\n" + block).length > limitChars) break;
    ctx += (ctx ? "\n" : "") + block;
  }
  return ctx;
}

// ---------- Load Swagger files ----------
const swaggerDir = path.join(__dirname);
const swaggerFiles = fs.readdirSync(swaggerDir).filter(f => f.endsWith(".yaml"));

const apiEntries = [];
const globalMetadata = [];

for (const fileName of swaggerFiles) {
  const filePath = path.join(swaggerDir, fileName);
  const fileContent = fs.readFileSync(filePath, "utf8");
  const doc = YAML.parse(fileContent);

  if (doc.info || doc.servers) {
    globalMetadata.push({
      fileName,
      title: doc.info?.title || "",
      version: doc.info?.version || "",
      description: doc.info?.description || "",
      servers: doc.servers?.map(s => s.url) || [],
    });
  }

  if (!doc.paths) continue;

  for (const pathKey in doc.paths) {
    const methods = doc.paths[pathKey];
    for (const method in methods) {
      const details = methods[method];
      const parameters = (details.parameters || [])
        .map(p => `${p.name || ""} ${p.description || ""}`)
        .join(" ");
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

const fuse = new Fuse(apiEntries, {
  keys: ["summary", "description", "path", "method", "operationId", "tags", "parameters"],
  threshold: 0.4,
  includeScore: true,
});

// ---------- Static Q&A ----------
const staticQA = {
  "what are plans?": `A plan is a collection of API resources or subsets of resources ...`,
  "how do i register an app?": `When you add an app you are provided with a client ID ...`,
  "how do i see my api usage?": `The number of requests, for different APIs ...`,
  "how can i test an api?": `It is possible to test an API from the Developer Portal ...`,
  "how do i reset my app client secret?": `It is possible to reset your Client Secret if you forget it ...`,
  "what is the base url of the api?": null // filled dynamically
};

// ---------- “Getting Started” menu ----------
const gettingStartedOptions = {
  "1": "Environment setup",
  "2": "Register on portal",
  "3": "Create app on portal",
  "4": "Subscribe to APIs",
  "5": "Terminology",
  "6": "OAuth",
  "7": "Open Banking",
};

const gettingStartedDetails = {
  "1": `**1. Environment setup** ...`,
  "2": `**2. Register on portal** ...`,
  "3": `**3. Create app on portal** ...`,
  "4": `**4. Subscribe to APIs** ...`,
  "5": `**5. Terminology** ...`,
  "6": `**6. OAuth** ...`,
  "7": `**7. Open Banking (PSD2)** ...`,
};

// ---------- Search API ----------
app.post("/search", async (req, res) => {
  const { query } = req.body;

  if (!query || typeof query !== "string") {
    return res.status(400).json({ error: "Query string is required." });
  }

  const normalizedQuery = query.trim().toLowerCase();

  // Greetings
  const greetingPatterns = ["hi", "hello", "hey", "good morning", "good afternoon", "good evening", "greetings"];
  if (greetingPatterns.includes(normalizedQuery)) {
    return res.json({ answer: "Hello! 👋 How can I help you with the Nedbank API Marketplace?" });
  }

  // Getting started menu
  if (normalizedQuery === "how to get started?") {
    const optionsList = Object.entries(gettingStartedOptions)
      .map(([num, title]) => `${num}. ${title}`)
      .join("\n");
    return res.json({
      answer: `Here are 7 steps to get started:\n\n${optionsList}\n\nReply with a number (1–7) to learn more.`
    });
  }

  if (gettingStartedDetails[normalizedQuery]) {
    return res.json({ answer: gettingStartedDetails[normalizedQuery] });
  }

  // Static Q&A first
  if (Object.keys(staticQA).includes(normalizedQuery)) {
    if (normalizedQuery === "what is the base url of the api?") {
      const allUrls = globalMetadata.flatMap(m => m.servers);
      if (allUrls.length === 0) {
        return res.json({ answer: "No base URL found in the documentation." });
      }
      return res.json({ answer: `Base URLs found:\n- ${allUrls.join("\n- ")}` });
    }
    return res.json({ answer: staticQA[normalizedQuery] });
  }

  // Fuzzy Swagger Search
  const results = fuse.search(query).slice(0, 5);
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

  if (isQuestion(query)) {
    const metaSummary =
      globalMetadata.length > 0
        ? "APIs:\n" +
          globalMetadata.map(m => `• ${m.title || m.fileName} v${m.version || "-"} servers: ${m.servers.join(", ") || "-"}`).join("\n")
        : "";

    const context = buildContext({ results, includeMeta: metaSummary });
    const prompt =
`You are an assistant for developers working on Nedbank APIs.
Answer briefly and accurately using ONLY the context. If unknown, say you don't know.

Question:
${query}

Context:
${context}

Answer:`;

    const aiAnswer = await callHuggingFace(prompt);

    if (matched.length > 0) {
      return res.json({ answer: aiAnswer, matches: matched });
    }
    return res.json({ answer: aiAnswer });
  }

  if (matched.length > 0) {
    return res.json({ matches: matched });
  }

  const metaOnly =
    globalMetadata.length > 0
      ? "APIs:\n" +
        globalMetadata.map(m => `• ${m.title || m.fileName} v${m.version || "-"} servers: ${m.servers.join(", ") || "-"}`).join("\n")
      : "No API metadata available.";

  const fallbackPrompt =
`User asked: "${query}"
This user needs help about Nedbank APIs. Use the metadata below to answer concisely. If insufficient, say you don't know.

Metadata:
${metaOnly}

Answer:`;

  const fallbackAnswer = await callHuggingFace(fallbackPrompt);
  return res.json({ answer: fallbackAnswer || "No matching API endpoint or metadata found." });
});

// Convenience: direct AI ask endpoint
app.post("/ask", async (req, res) => {
  const { question } = req.body;
  if (!question || typeof question !== "string") {
    return res.status(400).json({ error: "Field 'question' is required." });
  }

  const results = fuse.search(question).slice(0, 10);
  const metaSummary =
    globalMetadata.length > 0
      ? "APIs:\n" +
        globalMetadata.map(m => `• ${m.title || m.fileName} v${m.version || "-"} servers: ${m.servers.join(", ") || "-"}`).join("\n")
      : "";

  const context = buildContext({ results, includeMeta: metaSummary, limitChars: 4500 });

  const prompt =
`You are a helpful API assistant for Nedbank API Marketplace.
Use the provided context to answer the user's question. Be concise, step-by-step if needed.
If the answer is not in the context, say you don't know.

Question:
${question}

Context:
${context}

Answer:`;

  const aiAnswer = await callHuggingFace(prompt);
  return res.json({ answer: aiAnswer });
});

// Health Check
app.get("/", (req, res) => {
  res.send("Multi-Swagger API Documentation Bot is up and running!");
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});


