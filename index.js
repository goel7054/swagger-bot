const express = require("express");
const fs = require("fs");
const path = require("path");
const YAML = require("yaml");
const Fuse = require("fuse.js");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

const swaggerDir = path.join(__dirname);
const swaggerFiles = fs.readdirSync(swaggerDir).filter(f => f.endsWith('.yaml'));

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
  keys: ["summary", "description", "path", "method", "operationId", "tags", "parameters"],
  threshold: 0.4,
  includeScore: true,
});

// === Static exact question and answer pairs ===
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

  "what is the base url of the api?": null // will be filled dynamically
};

// === Search API ===
app.post("/search", (req, res) => {
  const { query } = req.body;

  if (!query || typeof query !== "string") {
    return res.status(400).json({ error: "Query string is required." });
  }

  const normalizedQuery = query.trim().toLowerCase();

  // Check static exact matches first
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

  // Fuzzy Swagger search
  const results = fuse.search(query).slice(0, 5);
  if (results.length > 0) {
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
    return res.json({ matches: matched });
  }

  // Metadata fallback
  if (normalizedQuery.includes("api title") || normalizedQuery.includes("api name")) {
    const titles = globalMetadata.map(m => `${m.fileName}: ${m.title}`);
    return res.json({ answer: `API Titles:\n${titles.join("\n")}` });
  }

  if (normalizedQuery.includes("api version")) {
    const versions = globalMetadata.map(m => `${m.fileName}: ${m.version}`);
    return res.json({ answer: `API Versions:\n${versions.join("\n")}` });
  }

  if (normalizedQuery.includes("api description")) {
    const descriptions = globalMetadata.map(m => `${m.fileName}: ${m.description}`);
    return res.json({ answer: `API Descriptions:\n${descriptions.join("\n\n")}` });
  }

  return res.json({ message: "No matching API endpoint or metadata found." });
});

// === Health Check ===
app.get("/", (req, res) => {
  res.send("Multi-Swagger API Documentation Bot is up and running!");
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
