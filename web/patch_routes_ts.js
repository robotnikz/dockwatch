const fs = require('fs');
const filePath = '/root/Github/dockwatch/server/src/routes/stacks.ts';
let content = fs.readFileSync(filePath, 'utf8');

// replace imports
content = content.replace("  getComposeContent,", "  getComposeContent,\n  getEnvContent,\n  saveEnvContent,");

// Update GET /:name
content = content.replace(
  "const content = await getComposeContent(req.params.name);\n    res.json({ name: req.params.name, content });",
  "const content = await getComposeContent(req.params.name);\n    const envContent = await getEnvContent(req.params.name);\n    res.json({ name: req.params.name, content, envContent });"
);

// Update PUT /:name
content = content.replace(
  "const { content } = req.body;\n    if (!content",
  "const { content, envContent } = req.body;\n    if (!content"
);

content = content.replace(
  "await saveComposeContent(req.params.name, content);",
  "await saveComposeContent(req.params.name, content);\n    if (envContent !== undefined) { await saveEnvContent(req.params.name, envContent); }"
);

fs.writeFileSync(filePath, content);
