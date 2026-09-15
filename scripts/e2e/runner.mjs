#!/usr/bin/env node
// Standalone E2E Test Runner
import { argv, exit } from "node:process";
import { harness } from "./framework.mjs";
import { registerTier1Tests } from "./tier1-features.mjs";
import { registerTier2Tests } from "./tier2-boundaries.mjs";
import { registerTier3Tests } from "./tier3-combinations.mjs";
import { registerTier4Tests } from "./tier4-scenarios.mjs";

// Register all test suites across Tiers 1 through 4
registerTier1Tests();
registerTier2Tests();
registerTier3Tests();
registerTier4Tests();

// Parse CLI flags
const args = argv.slice(2);
let tierFilter = null;
let featureFilter = null;
let summaryOnly = false;

for (const arg of args) {
  if (arg.startsWith("--tier=")) {
    tierFilter = Number(arg.split("=")[1]);
  } else if (arg.startsWith("--feature=")) {
    featureFilter = arg.split("=")[1];
  } else if (arg === "--summary") {
    summaryOnly = true;
  }
}

console.log("================================================================================");
console.log("             COCKPIT ORCHESTRATION OVERHAUL — E2E TEST RUNNER                   ");
console.log("================================================================================");
if (tierFilter) console.log(`Filter: Tier ${tierFilter}`);
if (featureFilter) console.log(`Filter: Feature ${featureFilter}`);
console.log(`Total tests registered: ${harness.tests.length}`);
console.log("--------------------------------------------------------------------------------\n");

const startTime = Date.now();
const summary = await harness.run({ tier: tierFilter, feature: featureFilter });
const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);

console.log("Execution complete in " + durationSec + "s.\n");

// Print tier results
console.log("Results by Tier:");
console.log("--------------------------------------------------------------------------------");
for (const [tier, res] of Object.entries(summary.byTier).sort()) {
  const tierName = {
    "1": "Tier 1: Feature Coverage (Happy Paths)",
    "2": "Tier 2: Boundary & Corner Cases",
    "3": "Tier 3: Cross-Feature Combinations",
    "4": "Tier 4: Real-World Application Scenarios",
  }[tier] || `Tier ${tier}`;
  const status = res.failed === 0 ? "PASS" : "FAIL";
  console.log(`  [${status}] ${tierName}: ${res.passed}/${res.total} passed (${res.failed} failed)`);
}

if (summary.failures.length > 0) {
  console.log("\nFailures:");
  console.log("--------------------------------------------------------------------------------");
  summary.failures.forEach((f, idx) => {
    console.log(`\n  ${idx + 1}) [Tier ${f.tier}] [${f.feature}] ${f.name}`);
    console.log(`     Error: ${f.error}`);
    if (f.stack) {
      console.log(`     ${f.stack.split("\n").slice(1, 4).join("\n     ")}`);
    }
  });
}

console.log("\n================================================================================");
console.log(`SUMMARY: ${summary.passed}/${summary.total} tests passed (${summary.failed} failed) in ${durationSec}s`);
console.log("================================================================================\n");

if (summary.failed > 0) {
  exit(1);
} else {
  exit(0);
}
