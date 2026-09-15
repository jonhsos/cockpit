# TEST_INFRA: Cockpit Orchestration Test Infrastructure & Strategy

## 1. Test Philosophy

### 1.1 Opaque-Box, Requirement-Driven Testing
The Cockpit orchestration test suite operates strictly on an **opaque-box, requirement-driven** philosophy. 
Tests do not bind to private internal implementation quirks, transient variables, or undocumented function signatures. Instead, every test case:
1. **Derives from Authoritative Requirements**: All inputs, preconditions, and expected outputs are derived directly from `ORIGINAL_REQUEST.md` (R1 through R13, Acceptance Criteria) and `PROJECT.md` (Domain contracts, Feature Inventory 1–53, Milestones).
2. **Exercises Observable Boundaries**: Tests target public HTTP REST endpoints, WebSocket event contracts, CLI command invocations (`cockpit list|connect|ask|reply|handoff`), filesystem state files, and process execution arguments (e.g. `/bin/bash -i -l`).
3. **Guarantees Independence & Isolation**: Each test runs in an isolated ephemeral context (e.g. unique mock mission, ephemeral state store, or distinct workspace path). Tests do not depend on execution order and clean up after themselves.
4. **Enforces Progressive Testability**: Tests verify observable interface contracts and domain rules with deterministic inputs and outputs.
5. **Rejects Facade Tests**: Every test assertion verifies real logic, state transitions, validation guards, and error responses. No dummy `assert.ok(true)` tests are permitted.

---

## 2. Test Architecture

### 2.1 Directory Structure
```
scripts/
├── testar.mjs                      # Existing master test runner
├── check-e2e.mjs                   # Master E2E gate script discovered by testar.mjs
└── e2e/                            # Complete E2E testing framework
    ├── runner.mjs                  # CLI runner with tier & feature filtering, formatted reporter
    ├── framework.mjs               # Core opaque-box test harness (describe, test, expect, assert)
    ├── fixtures.mjs                # Authoritative entity fixtures and schema contracts
    ├── tier1-features.mjs          # Tier 1: Feature Coverage (isolated happy paths, F1–F53)
    ├── tier2-boundaries.mjs        # Tier 2: Boundary & Corner Cases (F1–F53)
    ├── tier3-combinations.mjs      # Tier 3: Cross-Feature Combinations (pairwise & multi-feature)
    └── tier4-scenarios.mjs         # Tier 4: Real-World End-to-End Application Scenarios
```

### 2.2 Test Runner Invocation
The test suite can be run via multiple granular entry points:

- **Master Check (via existing runner)**:
  ```bash
  node scripts/check-e2e.mjs
  # Or via project test command:
  npm test
  ```
- **Direct E2E Runner (all tiers)**:
  ```bash
  node scripts/e2e/runner.mjs
  ```
- **Tier-Specific Invocation**:
  ```bash
  node scripts/e2e/runner.mjs --tier=1    # Run Tier 1 Feature Coverage (Happy Paths)
  node scripts/e2e/runner.mjs --tier=2    # Run Tier 2 Boundary & Corner Cases
  node scripts/e2e/runner.mjs --tier=3    # Run Tier 3 Cross-Feature Combinations
  node scripts/e2e/runner.mjs --tier=4    # Run Tier 4 Real-World Application Scenarios
  ```
- **Feature-Specific Invocation**:
  ```bash
  node scripts/e2e/runner.mjs --feature=F1   # Run all tests for Feature 1 (Sovereign Clean Bash)
  node scripts/e2e/runner.mjs --feature=F32  # Run all tests for Feature 32 (Isolated File Lock)
  ```
- **Summary Mode**:
  ```bash
  node scripts/e2e/runner.mjs --summary     # Output coverage matrix and counts without full logs
  ```

### 2.3 Pass/Fail Semantics & Exit Codes
- **Exit Code 0**: All executed test assertions passed.
- **Exit Code 1**: One or more test assertions failed.
- **Reporter Output**:
  - Each tier outputs clear headers and timing per test suite.
  - Failures output verbatim assertion errors, line numbers, expected vs actual values.
  - Test suite outputs a summary table showing:
    - Total tests executed
    - Passed count
    - Failed count
    - Coverage per Feature (F1 through F53 across Tiers 1–4)

---

## 3. Coverage Thresholds

| Tier | Category | Scope / Threshold | Target Count |
|---|---|---|---|
| **Tier 1** | Feature Coverage | Isolated happy paths verifying core functionality directly. Minimum >= 5 test cases per feature (53 features). | **265 tests** |
| **Tier 2** | Boundary & Corner Cases | Boundary conditions, empty inputs, invalid transitions, unavailable runner errors, 409 collisions, token redactions. Minimum >= 5 test cases per feature (53 features). | **265 tests** |
| **Tier 3** | Cross-Feature Combinations | Pairwise & multi-feature interaction scenarios (e.g. Task + File Lock + Pane Connection + Handoff). | **15 tests** |
| **Tier 4** | Real-World Application Scenarios | Complete end-to-end mission workflows (Livre, Dirigido, Autônomo, Recovery, Contention). | **5 tests** |
| **Total** | **Comprehensive Suite** | **Full 4-tier coverage of Features 1 through 53** | **550 tests** |

---

## 4. Feature Inventory Coverage Mapping

The following matrix maps every feature from `PROJECT.md` (Features 1 through 53) to its designated coverage counts across all 4 tiers:

| # | Feature Code | Feature Name | Tier 1 (Happy Path) | Tier 2 (Boundary/Corner) | Tier 3 (Cross-Feature) | Tier 4 (Real-World) | Total Tests |
|---|---|---|:---:|:---:|:---:|:---:|:---:|
| 1 | F1 | Sovereign Clean Bash | 5 | 5 | 2 | 1 | 13 |
| 2 | F2 | Zero Bash Prompt Injection | 5 | 5 | 1 | 1 | 12 |
| 3 | F3 | Bash Absolute Precedence | 5 | 5 | 2 | 1 | 13 |
| 4 | F4 | Decoupled Role Entity | 5 | 5 | 2 | 1 | 13 |
| 5 | F5 | Decoupled Runner Entity | 5 | 5 | 2 | 1 | 13 |
| 6 | F6 | Decoupled Model Entity | 5 | 5 | 1 | 1 | 12 |
| 7 | F7 | Persistent Connection Entity | 5 | 5 | 3 | 2 | 15 |
| 8 | F8 | Structured Task Entity | 5 | 5 | 4 | 2 | 16 |
| 9 | F9 | Structured Handoff Entity | 5 | 5 | 3 | 2 | 15 |
| 10 | F10 | Roles-First Catalog UI | 5 | 5 | 1 | 1 | 12 |
| 11 | F11 | 2-Step Selection Flow | 5 | 5 | 1 | 1 | 12 |
| 12 | F12 | Mission Renaming | 5 | 5 | 1 | 1 | 12 |
| 13 | F13 | Pane Renaming & Reclassifying | 5 | 5 | 1 | 1 | 12 |
| 14 | F14 | Real Connection Visual Lines | 5 | 5 | 2 | 1 | 13 |
| 15 | F15 | Visual Element Differentiation | 5 | 5 | 1 | 1 | 12 |
| 16 | F16 | No Silent Fallback to Codex | 5 | 5 | 2 | 1 | 13 |
| 17 | F17 | Roster Whitelist Enforcement | 5 | 5 | 2 | 1 | 13 |
| 18 | F18 | Task Type Model Isolation | 5 | 5 | 1 | 1 | 12 |
| 19 | F19 | Disabled Auto-Failover | 5 | 5 | 2 | 1 | 13 |
| 20 | F20 | `cockpit list` Verb | 5 | 5 | 2 | 1 | 13 |
| 21 | F21 | `cockpit connect` Verb | 5 | 5 | 3 | 2 | 15 |
| 22 | F22 | `cockpit ask` Verb | 5 | 5 | 3 | 2 | 15 |
| 23 | F23 | `cockpit reply` Verb | 5 | 5 | 3 | 2 | 15 |
| 24 | F24 | `cockpit handoff` Verb | 5 | 5 | 3 | 2 | 15 |
| 25 | F25 | Persistent Inbox/Outbox | 5 | 5 | 3 | 2 | 15 |
| 26 | F26 | Existing Pane Task Dispatch | 5 | 5 | 3 | 2 | 15 |
| 27 | F27 | Task CRUD & API Routes | 5 | 5 | 3 | 2 | 15 |
| 28 | F28 | 6-State Formal Lifecycle | 5 | 5 | 3 | 2 | 15 |
| 29 | F29 | Interactive Sidebar Task Board | 5 | 5 | 1 | 1 | 12 |
| 30 | F30 | Knowledge & Evidence Logging | 5 | 5 | 3 | 2 | 15 |
| 31 | F31 | Shared File Ownership Mode | 5 | 5 | 2 | 1 | 13 |
| 32 | F32 | Isolated File Ownership Mode | 5 | 5 | 3 | 2 | 15 |
| 33 | F33 | Modo Livre (Default) | 5 | 5 | 2 | 2 | 14 |
| 34 | F34 | Modo Dirigido | 5 | 5 | 2 | 2 | 14 |
| 35 | F35 | Modo Autônomo | 5 | 5 | 2 | 2 | 14 |
| 36 | F36 | Disk State Persistence | 5 | 5 | 2 | 2 | 14 |
| 37 | F37 | UI/Server Decoupled PTY | 5 | 5 | 2 | 2 | 14 |
| 38 | F38 | WS Session Resumption | 5 | 5 | 2 | 2 | 14 |
| 39 | F39 | 8-State Granular Pane Lifecycle | 5 | 5 | 2 | 1 | 13 |
| 40 | F40 | Granular Audit Trail | 5 | 5 | 2 | 1 | 13 |
| 41 | F41 | Secret & Credential Redaction | 5 | 5 | 2 | 1 | 13 |
| 42 | F42 | Scoped Workspace Permissions | 5 | 5 | 2 | 1 | 13 |
| 43 | F43 | Destructive Action Confirmations | 5 | 5 | 1 | 1 | 12 |
| 44 | F44 | Modular Routes Directory | 5 | 5 | 1 | 1 | 12 |
| 45 | F45 | Modular WebSocket Directory | 5 | 5 | 1 | 1 | 12 |
| 46 | F46 | Modular Orchestration Directory | 5 | 5 | 2 | 1 | 13 |
| 47 | F47 | Modular Sessions Directory | 5 | 5 | 2 | 1 | 13 |
| 48 | F48 | Modular Tasks Directory | 5 | 5 | 2 | 1 | 13 |
| 49 | F49 | Modular Connections Directory | 5 | 5 | 2 | 1 | 13 |
| 50 | F50 | Modular Missions Directory | 5 | 5 | 2 | 1 | 13 |
| 51 | F51 | Modular Providers Directory | 5 | 5 | 2 | 1 | 13 |
| 52 | F52 | Modular Persistence Directory | 5 | 5 | 2 | 1 | 13 |
| 53 | F53 | Modular Security Directory | 5 | 5 | 2 | 1 | 13 |
| **Total** | | | **265** | **265** | **15** | **5** | **550** |

---

## 5. Authoritative Expected Output Derivations

All expected values in the test suite are derived from the following authoritative documents:
1. **R1 (Sovereign Clean Bash)**: `ORIGINAL_REQUEST.md:12-20` & `PROJECT.md:32-34`
   - Command: `/bin/bash`, arguments: `["-i", "-l"]`.
   - Stdin bytes written on boot: `0`.
   - Environment: Clean shell, no prompt injected, no LLM auto-start.
2. **R2 (Concept Decoupling)**: `ORIGINAL_REQUEST.md:21-30` & `PROJECT.md:35-40`
   - Role, Runner, Model, Pane, Connection, Task, Handoff are isolated entities.
   - Role schema does not mandate or infer runner or model.
3. **R3 (UI & Catalog)**: `ORIGINAL_REQUEST.md:32-40` & `PROJECT.md:41-46`
   - Catalog lists pure roles first without model names.
   - 2-step selection: Role -> Runner -> Model.
   - Connection wires only exist when real `Connection` entity exists.
4. **R4 (Harness Policies)**: `ORIGINAL_REQUEST.md:41-49` & `PROJECT.md:47-50`
   - Unavailable runner emits explicit error message (no fallback to Codex).
   - Elenco rejects unauthorized CLIs with explicit message.
   - `maestroAutoSwitch: false` by default.
5. **R5 (Inter-Pane Communication)**: `ORIGINAL_REQUEST.md:50-60` & `PROJECT.md:51-57`
   - Persistent `Connection` entity.
   - Safe mailbox queues (`inbox` / `outbox`).
   - Verbs `cockpit list`, `connect`, `ask`, `reply`, `handoff`. Zero commands typed into bash stdin.
6. **R6 (Task Lifecycle & Board)**: `ORIGINAL_REQUEST.md:61-66` & `PROJECT.md:58-61`
   - 13 fields: `id`, `title`, `description`, `assignee`, `role`, `pane`, `allowedFiles`, `dependencies`, `priority`, `status`, `evidence`, `result`, `timestamps`.
   - 6 states: `todo`, `in-progress`, `blocked`, `in-review`, `complete`, `failed`.
7. **R7 (File Ownership)**: `ORIGINAL_REQUEST.md:67-70` & `PROJECT.md:62-63`
   - `isolated`: Exclusive lock, collision returns HTTP 409 Conflict with `conflictFiles` & `lockedBy`.
   - `shared`: Visual warning `fs:collision_warning`.
8. **R8 (Mission Modes)**: `ORIGINAL_REQUEST.md:71-77` & `PROJECT.md:64-66`
   - Modes: `livre` (default, manual), `dirigido` (guided team delegation), `autonomo` (scoped creation).
9. **R9 (Persistence & Resilience)**: `ORIGINAL_REQUEST.md:78-81` & `PROJECT.md:67-69`
   - Disk store retains state across restart.
   - Decoupled PTY daemon preserves running processes when web server restarts.
10. **R10 (States & Observability)**: `ORIGINAL_REQUEST.md:82-85` & `PROJECT.md:70-71`
    - 8 pane states: `starting`, `waiting-user`, `working`, `blocked`, `review`, `completed`, `failed`, `dead`.
    - Audit log records activities, costs, tokens, commands, errors.
11. **R11 (Security & Permissions)**: `ORIGINAL_REQUEST.md:86-93` & `PROJECT.md:72-74`
    - Secret redaction (`[REDACTED]`) for keys/tokens.
    - Default permission `workspace-write`.
    - Destructive actions require explicit confirmation.
12. **R12 (Modular Architecture)**: `ORIGINAL_REQUEST.md:94-106` & `PROJECT.md:75-84`
    - 10 modular directories under `servidor/`.

---

## 6. Verification and Integration
- The E2E suite is integrated directly into the master verification runner `scripts/testar.mjs` via `scripts/check-e2e.mjs`.
- Running `npm test` runs all verification steps including the E2E verification suite.
- Detailed test readiness results and execution instructions are documented in `TEST_READY.md`.
