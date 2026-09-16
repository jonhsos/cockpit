import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const projectFiles = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const secretPatterns = [
  ["Anthropic API key", /\bsk-ant-(?:api\d{2}-|admin\d{2}-)[A-Za-z0-9_-]{20,}\b/g],
  ["OpenAI API key", /\bsk-(?:proj-|admin-)[A-Za-z0-9_-]{20,}\b/g],
  ["OpenRouter API key", /\bsk-or-v1-[A-Fa-f0-9]{32,}\b/g],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ["AWS access key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g],
  ["Private key", /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----/g],
];

const findings = [];
for (const file of projectFiles) {
  let source;
  try {
    const bytes = readFileSync(file);
    if (bytes.includes(0)) continue;
    source = bytes.toString("utf8");
  } catch {
    continue;
  }
  for (const [name, pattern] of secretPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(source)) findings.push(`${file}: ${name}`);
  }
}

if (findings.length > 0) {
  console.error("Possíveis credenciais hardcoded encontradas:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`PASS: nenhuma credencial conhecida encontrada em ${projectFiles.length} arquivos do projeto.`);
