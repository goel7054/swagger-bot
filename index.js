require("dotenv").config();

const express = require("express");
const fs = require("fs");
const path = require("path");
const YAML = require("yaml");
const Fuse = require("fuse.js");
const cors = require("cors");

// ---------- App ----------
const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());
app.use(cors());

// ---------- Optional cache dir ----------
if (!process.env.TRANSFORMERS_CACHE) {
  process.env.TRANSFORMERS_CACHE = path.join(__dirname, ".transformers-cache");
}

// ---------- Local AI ----------
const LOCAL_QA_MODEL =
  process.env.LOCAL_QA_MODEL || "Xenova/distilbert-base-cased-distilled-squad";
const LOCAL_T2T_MODEL = process.env.LOCAL_T2T_MODEL || "Xenova/t5-small";

let _pipeline;
const PIPE_CACHE = {};

async function getPipeline(task, model) {
  if (!_pipeline) _pipeline = await import("@xenova/transformers");
  const key = `${task}::${model}`;
  if (!PIPE_CACHE[key]) {
    PIPE_CACHE[key] = _pipeline.pipeline(task, model);
    console.log(`[AI] Loading ${task} → ${model} (first run may download weights)`);
  }
  return PIPE_CACHE[key];
}

// ---------- Safe Text Helper ----------
function safeText(input) {
  if (typeof input === "string") return input;
  if (Array.isArray(input)) return input.map(safeText).join(" ");
  if (typeof input === "object" && input !== null)
    return Object.values(input).map(safeText).join(" ");
  return String(input || "");
}

// ---------- Answer With Local AI ----------
async function answerWithLocalAI({ question, context }) {
  const safeQuestion = safeText(question).trim();
  const safeContext = safeText(context).replace(/\s+/g, " ").trim();

  // 1) Extractive QA
  try {
    const qa = await getPipeline("question-answering", LOCAL_QA_MODEL);
    const out = await qa({ question: safeQuestion, context: safeContext });
    if (out?.answer && out.answer.trim()) {
      if ((out.score ?? 0) >= 0.25 || out.answer.trim().length >= 12) {
        return out.answer;
      }
    }
  } catch (e) {
    console.error("[AI] QA error:", e?.message || e);
  }

  // 2) Fallback text2text generation
  try {
    const t2t = await getPipeline("text2text-generation", LOCAL_T2T_MODEL);
    const prompt = `Answer the user's question using ONLY the context below. If the answer isn't in the context, say "I don't know."

Context:
${safeContext}

Question: ${safeQuestion}

Answer:`;
    const out = await t2t(prompt, { max_new_tokens: 256 });
    if (Array.isArray(out) && out[0]?.generated_text) return out[0].generated_text;
    return "I don't know.";
  } catch (e) {
    console.error("[AI] T2T error:", e?.message || e);
    return "Local AI is warming up or unavailable. Please try again.";
  }
}

// ---------- Helpers ----------
function isQuestion(q) {
  const s = (q || "").trim().toLowerCase();
  if (s.endsWith("?")) return true;
  const starters = ["how","what","where","when","why","can","does","do","is","are","should","could","explain"];
  return starters.some((w) => s.startsWith(w + " "));
}

function buildContext({ results = [], limitChars = 3500, includeMeta = "" }) {
  const lines = includeMeta ? [includeMeta] : [];
  for (const r of results) {
    const it = r.item;
    lines.push(
      `[${it.method}] ${it.path} (${it.sourceFile})\nsummary: ${it.summary || "-"}\ndesc: ${it.description || "-"}\noperationId: ${it.operationId || "-"}\ntags: ${it.tags || "-"}\nparams: ${it.parameters || "-"}`
    );
  }
  let ctx = "";
  for (const block of lines) {
    if ((ctx + "\n" + block).length > limitChars) break;
    ctx += (ctx ? "\n" : "") + block;
  }
  return ctx;
}

// ---------- Load Swagger ----------
const swaggerDir = path.join(__dirname);
const swaggerFiles = fs.readdirSync(swaggerDir).filter(f => f.endsWith(".yaml"));
const apiEntries = [];
const globalMetadata = [];

for (const fileName of swaggerFiles) {
  const filePath = path.join(__dirname, fileName);
  const doc = YAML.parse(fs.readFileSync(filePath, "utf8"));

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

const fuse = new Fuse(apiEntries, {
  keys: ["summary","description","path","method","operationId","tags","parameters"],
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
  "what is the base url of the api?": null,
};

// ---------- “Getting Started” ----------
const gettingStartedOptions = { "1":"Environment setup","2":"Register on portal","3":"Create app on portal","4":"Subscribe to APIs","5":"Terminology","6":"OAuth","7":"Open Banking" };
const gettingStartedDetails = { "1":"**1. Environment setup** ...","2":"**2. Register on portal** ...","3":"**3. Create app on portal** ...","4":"**4. Subscribe to APIs** ...","5":"**5. Terminology** ...","6":"**6. OAuth** ...","7":"**7. Open Banking (PSD2)** ..." };

// ---------- Routes ----------
app.post("/search", async (req, res) => {
  const { query } = req.body;
  if (!query || typeof query !== "string") return res.status(400).json({ error: "Query string is required." });

  const normalizedQuery = query.trim().toLowerCase();
  const greetingPatterns = ["hi","hello","hey","good morning","good afternoon","good evening","greetings"];
  if (greetingPatterns.includes(normalizedQuery)) return res.json({ answer:"Hello! 👋 How can I help you with the Nedbank API Marketplace?" });

  if (normalizedQuery === "how to get started?") {
    const optionsList = Object.entries(gettingStartedOptions).map(([num, title])=>`${num}. ${title}`).join("\n");
    return res.json({ answer:`Here are 7 steps to get started:\n\n${optionsList}\n\nReply with a number (1–7) to learn more.` });
  }

  if (gettingStartedDetails[normalizedQuery]) return res.json({ answer:gettingStartedDetails[normalizedQuery] });

  if (Object.keys(staticQA).includes(normalizedQuery)) {
    if (normalizedQuery === "what is the base url of the api?") {
      const allUrls = globalMetadata.flatMap(m => m.servers);
      return res.json({ answer: allUrls.length ? `Base URLs found:\n- ${allUrls.join("\n- ")}` : "No base URL found in the documentation." });
    }
    return res.json({ answer: staticQA[normalizedQuery] });
  }

  const results = fuse.search(query).slice(0,5);
  const matched = results.map(r=>({ path:r.item.path, method:r.item.method, summary:r.item.summary, description:r.item.description, operationId:r.item.operationId, tags:r.item.tags, source:r.item.sourceFile, score:r.score.toFixed(2) }));

  const metaSummary = globalMetadata.length ? "APIs:\n"+globalMetadata.map(m=>`• ${m.title||m.fileName} v${m.version||"-"} servers: ${m.servers.join(", ")||"-"}`).join("\n") : "";
  const context = buildContext({ results, includeMeta: metaSummary });

  if (isQuestion(query)) {
    const aiAnswer = await answerWithLocalAI({ question: query, context });
    return matched.length ? res.json({ answer: aiAnswer, matches: matched }) : res.json({ answer: aiAnswer });
  }

  if (matched.length) return res.json({ matches: matched });

  const fallbackContext = metaSummary || "No API metadata available.";
  const aiAnswer = await answerWithLocalAI({ question: query, context: fallbackContext });
  return res.json({ answer: aiAnswer || "No matching API endpoint or metadata found." });
});

// Direct AI ask
app.post("/qa", async (req, res) => {
  try {
    const { question, context } = req.body;
    const answer = await answerWithLocalAI({ question, context });
    res.json({ answer });
  } catch (err) {
    console.error("[QA Error]", err);
    res.status(500).json({ error: "Failed to get answer" });
  }
});

// Health Check
app.get("/", (req,res)=>res.send("Multi-Swagger API Documentation Bot (local transformers.js) is up and running!"));

app.listen(PORT, ()=>console.log(`Server is running on port ${PORT}`));
