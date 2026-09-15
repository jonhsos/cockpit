import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertWithinWorkspace,
  resolveSandboxFlags,
  validateStdinWrite,
  PermissionError,
} from "../servidor/security/index.ts";

console.log("Running check-security-permissions.ts...");

const testWorkspace = mkdtempSync(join(tmpdir(), "cockpit-test-permissions-"));
const outsideDir = mkdtempSync(join(tmpdir(), "cockpit-test-outside-"));

try {
  // 1. Valid child paths allowed
  mkdirSync(join(testWorkspace, "src"));
  writeFileSync(join(testWorkspace, "src", "index.ts"), "console.log('hi');");

  const resolvedValid = assertWithinWorkspace("src/index.ts", testWorkspace);
  assert.equal(resolvedValid, join(testWorkspace, "src", "index.ts"));
  console.log("  ✓ 1. Valid child path inside workspace allowed");

  // 2. Directory traversal rejected
  assert.throws(
    () => {
      assertWithinWorkspace("../../etc/passwd", testWorkspace);
    },
    (err: any) => err instanceof PermissionError
  );
  console.log("  ✓ 2. Path traversal escaping workspace rejected");

  // 3. Symlink pointing outside rejected
  const outsideFile = join(outsideDir, "secret.txt");
  writeFileSync(outsideFile, "confidential");
  const symlinkPath = join(testWorkspace, "symlink-outside");
  symlinkSync(outsideFile, symlinkPath);

  assert.throws(
    () => {
      assertWithinWorkspace("symlink-outside", testWorkspace);
    },
    (err: any) => err instanceof PermissionError
  );
  console.log("  ✓ 3. Symlink pointing outside workspace rejected");

  // 4. Restricted intra-workspace repository paths (.git/hooks, .git/config) rejected
  mkdirSync(join(testWorkspace, ".git", "hooks"), { recursive: true });
  writeFileSync(join(testWorkspace, ".git", "hooks", "pre-commit"), "#!/bin/sh\nexit 0");

  assert.throws(
    () => {
      assertWithinWorkspace(".git/hooks/pre-commit", testWorkspace);
    },
    (err: any) => err instanceof PermissionError
  );
  console.log("  ✓ 4. Restricted .git/hooks access rejected");

  // 5. CLI Sandbox Flags: Default workspace-write mode
  const codexFlagsDefault = resolveSandboxFlags("codex");
  assert.equal(codexFlagsDefault.permissionMode, "workspace-write");
  assert.deepEqual(codexFlagsDefault.args, ["--sandbox", "workspace-write"]);
  assert.equal(codexFlagsDefault.dangerOptIn, false);

  const claudeFlagsDefault = resolveSandboxFlags("claude");
  assert.equal(claudeFlagsDefault.permissionMode, "workspace-write");
  assert.ok(!claudeFlagsDefault.args.includes("--dangerously-skip-permissions"));
  assert.equal(claudeFlagsDefault.dangerOptIn, false);

  const agyFlagsDefault = resolveSandboxFlags("agy");
  assert.equal(agyFlagsDefault.permissionMode, "workspace-write");
  assert.ok(!agyFlagsDefault.args.includes("--dangerously-skip-permissions"));

  const geminiFlagsDefault = resolveSandboxFlags("gemini");
  assert.equal(geminiFlagsDefault.permissionMode, "workspace-write");
  assert.ok(!geminiFlagsDefault.args.includes("-y"));
  console.log("  ✓ 5. Default workspace-write sandbox flags enforced for all CLIs");

  // 6. Danger flags require explicit confirmation
  const dangerUnconfirmed = resolveSandboxFlags("claude", "danger-full-access", false);
  assert.equal(dangerUnconfirmed.permissionMode, "workspace-write");
  assert.ok(!dangerUnconfirmed.args.includes("--dangerously-skip-permissions"));

  const dangerConfirmed = resolveSandboxFlags("claude", "danger-full-access", true);
  assert.equal(dangerConfirmed.permissionMode, "danger-full-access");
  assert.deepEqual(dangerConfirmed.args, ["--dangerously-skip-permissions"]);
  assert.equal(dangerConfirmed.dangerOptIn, true);

  const geminiDangerConfirmed = resolveSandboxFlags("gemini", "danger-full-access", true);
  assert.deepEqual(geminiDangerConfirmed.args, ["-y"]);
  console.log("  ✓ 6. Danger-full-access elevation restricted to explicit user opt-in");

  // 7. Stdin protection: Prohibit agent text in bash stdin
  assert.throws(
    () => {
      validateStdinWrite("bash", "agent");
    },
    (err: any) => err instanceof PermissionError
  );

  // Human text is allowed in bash stdin
  assert.doesNotThrow(() => {
    validateStdinWrite("bash", "human");
  });

  // Agent text is allowed in non-bash runners
  assert.doesNotThrow(() => {
    validateStdinWrite("codex", "agent");
  });
  console.log("  ✓ 7. Bash stdin protection against agent text injection validated");

  console.log("\nPASS: all security permissions checks passed.");
} finally {
  try {
    rmSync(testWorkspace, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  } catch {
    // Best effort cleanup
  }
}
