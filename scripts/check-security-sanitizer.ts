import assert from "node:assert/strict";
import {
  sanitize,
  sanitizeObject,
  StreamSanitizer,
  SecretRegistry,
  REDACTED_MARKER,
} from "../servidor/security/index.ts";
import { TEST_SECRET_VALUES } from "./security-test-values.mjs";

console.log("Running check-security-sanitizer.ts...");

// 1. Anthropic API Key Sanitization
const anthropicInput = `Exporting ANTHROPIC_API_KEY=${TEST_SECRET_VALUES.anthropicApi03} to environment`;
const anthropicClean = sanitize(anthropicInput);
assert.equal(
  anthropicClean,
  `Exporting ANTHROPIC_API_KEY=${REDACTED_MARKER} to environment`
);
console.log("  ✓ 1. Anthropic key redaction validated");

// 2. OpenAI API Key Sanitization
const openaiInput = `curl https://api.openai.com/v1/models -H 'Authorization: Bearer ${TEST_SECRET_VALUES.openAiProject}'`;
const openaiClean = sanitize(openaiInput);
assert.ok(!openaiClean.includes("sk-proj-"));
assert.ok(openaiClean.includes(REDACTED_MARKER));
console.log("  ✓ 2. OpenAI key redaction validated");

// 3. OpenRouter API Key Sanitization
const openrouterInput = `OPENROUTER_KEY=${TEST_SECRET_VALUES.openRouter}`;
const openrouterClean = sanitize(openrouterInput);
assert.equal(openrouterClean, `OPENROUTER_KEY=${REDACTED_MARKER}`);
console.log("  ✓ 3. OpenRouter key redaction validated");

// 4. Google API Key Sanitization
const googleInput = `GEMINI_API_KEY=${TEST_SECRET_VALUES.google}`;
const googleClean = sanitize(googleInput);
assert.equal(googleClean, `GEMINI_API_KEY=${REDACTED_MARKER}`);
console.log("  ✓ 4. Google key redaction validated");

// 5. Bearer Token Sanitization
const bearerInput = `Authorization: ${TEST_SECRET_VALUES.bearer}`;
const bearerClean = sanitize(bearerInput);
assert.equal(bearerClean, `Authorization: Bearer ${REDACTED_MARKER}`);
console.log("  ✓ 5. Bearer token redaction validated");

// 6. Dynamically Registered Secret Sanitization
const customSecret = TEST_SECRET_VALUES.custom;
SecretRegistry.register(customSecret);
const customInput = `Connecting to internal service using secret: ${customSecret} in header`;
const customClean = sanitize(customInput);
assert.equal(
  customClean,
  `Connecting to internal service using secret: ${REDACTED_MARKER} in header`
);
SecretRegistry.unregister(customSecret);
console.log("  ✓ 6. Dynamically registered secret redaction validated");

// 7. StreamSanitizer: Token split across chunk boundaries
const streamSanitizer = new StreamSanitizer();
// Chunk 1 ends in partial prefix: "sk-ant-"
const chunk1 = "Starting task with Anthropic key: sk-ant-";
const out1 = streamSanitizer.process(chunk1);
// Chunk 1 should withhold the partial prefix
assert.equal(out1, "Starting task with Anthropic key: ");

// Chunk 2 provides the rest of the key and trailing content
const chunk2 = `${TEST_SECRET_VALUES.anthropicApi03.slice("sk-ant-".length)} and more logs`;
const out2 = streamSanitizer.process(chunk2);
// The combined secret should be redacted
assert.equal(out2, `${REDACTED_MARKER} and more logs`);

const flushed = streamSanitizer.flush();
assert.equal(flushed, "");
console.log("  ✓ 7. StreamSanitizer chunk boundary split handling validated");

// 8. Deep Object Sanitization
const nestedPayload = {
  mission: "m1",
  headers: {
    authorization: `Bearer ${TEST_SECRET_VALUES.openAiProject}`,
  },
  env: [
    `ANTHROPIC_API_KEY=${TEST_SECRET_VALUES.anthropicApi03}`,
    "SAFE_VAR=hello_world",
  ],
  metadata: {
    googleKey: TEST_SECRET_VALUES.google,
    nestedDeep: {
      key: TEST_SECRET_VALUES.openRouter,
    },
  },
};

const sanitizedPayload = sanitizeObject(nestedPayload);
assert.equal(
  sanitizedPayload.headers.authorization,
  `Bearer ${REDACTED_MARKER}`
);
assert.equal(
  sanitizedPayload.env[0],
  `ANTHROPIC_API_KEY=${REDACTED_MARKER}`
);
assert.equal(sanitizedPayload.env[1], "SAFE_VAR=hello_world");
assert.equal(sanitizedPayload.metadata.googleKey, REDACTED_MARKER);
assert.equal(sanitizedPayload.metadata.nestedDeep.key, REDACTED_MARKER);
console.log("  ✓ 8. Recursive object deep sanitization validated");

console.log("\nPASS: all security sanitizer checks passed.");
