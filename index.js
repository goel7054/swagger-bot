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
const HF_MODEL = process.env.HF_MODEL || "bigscience/bloomz-560m"; // small & fast for POC
// HF task: flan-t5 uses text2text-generation
const HF_TASK = process.env.HF_TASK || "text2text-generation";

// Helper: call Hugging Face Inference API
async function callHuggingFace(prompt) {
  if (!HF_API_KEY) {
    return "Hugging Face API key is not configured. Please set HF_API_KEY.";
  }

  try {
    const url = `https://api-inference.huggingface.co/models/${HF_MODEL}`;
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

    // Handle both common HF response shapes
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
  } catch (err) {
    console.error("HF error:", err.response?.data || err.message);
    return `AI answer unavailable right now. (${err.response?.status || ""} ${err.response?.statusText || err.message})`;
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
  "what are plans?": `A plan is a collection of API resources or subsets of resources from one or more API. A plan can contain a mixture of HTTP, GET, PUT, POST and DELETE actions from different APIs or it can contain all the actions from various APIs. A plan can have a common rate limit for all the resources or each resource can have a different rate limit. Rate limits specify how many calls an app is allowed to make during a specified time interval.

Use the Developer Portal to browse the different plans that are available and select a plan that is more suitable for your requirements. Some plans are restricted and require you to request access before you can use them. When you submit your request, the organisation is notified, the API administrator assesses your request and they might contact you for more details. Other plans are available to use straight away.`,

  "how do i register an app?": `When you add an app you are provided with a client ID and client secret for the app. You must supply the client ID when you call an API that requires you to identify your app by using a client ID, or a client ID and client secret.

To register an app click on Apps in the main menu and then click on the 'Register an application' link. Once you have provided an app name, description, etc you will be shown your app client ID and client secret.

Make a note of your client secret because it is only displayed once. You must supply the client secret when you call an API that requires you to identify your app by using a Client ID and Client secret.`,

  "how do i see my api usage?": `The number of requests, for different APIs, that your application has made are shown on your application page.

Click 'Apps' in the main menu and then click on your application. Under 'Subscribed Plans' you will see all plans your application is subscribed to.

For each API contained in that plan you can see the usage compared to the rate limit of the plan.`,

  "how can i test an api?": `It is possible to test an API from the Developer Portal.

When looking at the details of an API, you will see a table of the operations contained in the API. This will show what method they use (GET, POST, PUT, DELETE, PATCH, HEAD or OPTIONS) and what path the resource uses.

If you select the resource, you will see more information about it: which parameters it may take, what it returns, what possible return codes it may use and what they mean.

There is also a ‘Try’ button which enables you to try the resource out directly from the Developer Portal.

If the API requires a Client ID or a Client Secret for identification, you can specify these at the top of the ‘Try’ section.`,

  "how do i reset my app client secret?": `It is possible to reset your Client Secret if you forget it.

To do this click on ‘Apps’ in the main menu, click on the app in question, navigate to the ‘Client Secret’ section and select ‘Reset’.`,

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
  "1": `**1. Environment setup**

Before you test APIs, set up your local environment:

🛠 Code Editors:
- Visual Studio Code
- Eclipse
- Atom
- Vim

🔧 API Tools:
- Postman
- cURL
- SOAP UI`,

  "2": `**2. Register on portal**

1. Click 'Register your interest'.
2. Fill in the registration form.
3. Click the email verification link to activate your account.`,

  "3": `**3. Create app on portal**

1. Log in to the portal.
2. Go to 'My applications' and click 'Create application'.
3. Fill in details and save your Client ID & Secret.`,

  "4": `**4. Subscribe to APIs**

1. Go to the API product page.
2. Click 'Subscribe', select a plan, and choose your app.
3. You're now ready to call the API!`,

  "5": `**5. Terminology**

- **Authentication**: Proves identity.
- **Authorisation**: Grants access rights.
- **Tokens**: Bearer tokens used to access APIs securely.`,

  "6": `**6. OAuth**

OAuth 2.0 enables secure authorisation without sharing credentials. Our APIs use this protocol for safe access.`,

  "7": `**7. Open Banking (PSD2)**

PSD2 allows third-party apps to access banking data securely with user consent — enabling better innovation and control.`,
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

  // If the user asked a question, try generating an AI answer with retrieved context
  if (isQuestion(query)) {
    const metaSummary =
      globalMetadata.length > 0
        ? "APIs:\n" +
          globalMetadata
            .map(m => `• ${m.title || m.fileName} v${m.version || "-"} servers: ${m.servers.join(", ") || "-"}`)
            .join("\n")
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

    // Return both (UI may show matches first; you can later surface answer in UI)
    if (matched.length > 0) {
      return res.json({ answer: aiAnswer, matches: matched });
    }
    return res.json({ answer: aiAnswer });
  }

  // Not a question: if we have matches, return them
  if (matched.length > 0) {
    return res.json({ matches: matched });
  }

  // Fallback: no matches → try AI with only metadata
  const metaOnly =
    globalMetadata.length > 0
      ? "APIs:\n" +
        globalMetadata
          .map(m => `• ${m.title || m.fileName} v${m.version || "-"} servers: ${m.servers.join(", ") || "-"}`)
          .join("\n")
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

// Convenience: direct AI ask endpoint (always returns LLM answer)
app.post("/ask", async (req, res) => {
  const { question } = req.body;
  if (!question || typeof question !== "string") {
    return res.status(400).json({ error: "Field 'question' is required." });
  }

  // retrieve a broader context (top 10)
  const results = fuse.search(question).slice(0, 10);
  const metaSummary =
    globalMetadata.length > 0
      ? "APIs:\n" +
        globalMetadata
          .map(m => `• ${m.title || m.fileName} v${m.version || "-"} servers: ${m.servers.join(", ") || "-"}`)
          .join("\n")
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






