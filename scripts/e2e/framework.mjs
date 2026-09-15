// Opaque-box E2E Test Framework
import assert from "node:assert/strict";

class TestHarness {
  constructor() {
    this.tests = [];
    this.currentTier = null;
    this.currentFeature = null;
    this.currentSuite = null;
    this.results = [];
  }

  setContext(tier, feature, suiteName) {
    this.currentTier = tier;
    this.currentFeature = feature;
    this.currentSuite = suiteName;
  }

  register(name, fn, opts = {}) {
    this.tests.push({
      tier: opts.tier ?? this.currentTier ?? 1,
      feature: opts.feature ?? this.currentFeature ?? "General",
      suite: opts.suite ?? this.currentSuite ?? "General",
      name,
      fn,
    });
  }

  async run(filter = {}) {
    const tierFilter = (filter.tier !== undefined && filter.tier !== null) ? Number(filter.tier) : null;
    const featureFilter = (filter.feature !== undefined && filter.feature !== null) ? String(filter.feature).toUpperCase() : null;

    const matchedTests = this.tests.filter((t) => {
      if (tierFilter !== null && t.tier !== tierFilter) return false;
      if (featureFilter !== null && t.feature.toUpperCase() !== featureFilter) return false;
      return true;
    });

    const summary = {
      total: matchedTests.length,
      passed: 0,
      failed: 0,
      failures: [],
      byTier: {},
      byFeature: {},
      startedAt: Date.now(),
      endedAt: null,
      durationMs: 0,
    };

    for (const test of matchedTests) {
      summary.byTier[test.tier] = summary.byTier[test.tier] || { passed: 0, failed: 0, total: 0 };
      summary.byFeature[test.feature] = summary.byFeature[test.feature] || { passed: 0, failed: 0, total: 0 };
      summary.byTier[test.tier].total++;
      summary.byFeature[test.feature].total++;

      try {
        await test.fn();
        summary.passed++;
        summary.byTier[test.tier].passed++;
        summary.byFeature[test.feature].passed++;
      } catch (err) {
        summary.failed++;
        summary.byTier[test.tier].failed++;
        summary.byFeature[test.feature].failed++;
        summary.failures.push({
          tier: test.tier,
          feature: test.feature,
          suite: test.suite,
          name: test.name,
          error: err.message || String(err),
          stack: err.stack,
        });
      }
    }

    summary.endedAt = Date.now();
    summary.durationMs = summary.endedAt - summary.startedAt;
    this.results = summary;
    return summary;
  }
}

export const harness = new TestHarness();

export function setTestScope(tier, feature, suiteName) {
  harness.setContext(tier, feature, suiteName);
}

export function test(name, fn) {
  harness.register(name, fn);
}

export const it = test;

export function describe(suiteName, fn) {
  const prevSuite = harness.currentSuite;
  harness.currentSuite = suiteName;
  fn();
  harness.currentSuite = prevSuite;
}

export { assert };

export const expect = (actual) => {
  const matchers = {
    toBe: (expected, msg) => assert.equal(actual, expected, msg),
    toEqual: (expected, msg) => assert.deepEqual(actual, expected, msg),
    toBeTruthy: (msg) => assert.ok(Boolean(actual), msg),
    toBeFalsy: (msg) => assert.ok(!Boolean(actual), msg),
    toBeUndefined: (msg) => assert.equal(actual, undefined, msg),
    toBeDefined: (msg) => assert.notEqual(actual, undefined, msg),
    toBeGreaterThan: (expected, msg) => assert.ok(actual > expected, msg || `Expected ${actual} > ${expected}`),
    toBeLessThan: (expected, msg) => assert.ok(actual < expected, msg || `Expected ${actual} < ${expected}`),
    toBeGreaterThanOrEqual: (expected, msg) => assert.ok(actual >= expected, msg || `Expected ${actual} >= ${expected}`),
    toBeLessThanOrEqual: (expected, msg) => assert.ok(actual <= expected, msg || `Expected ${actual} <= ${expected}`),
    toContain: (item, msg) => {
      if (typeof actual === "string") {
        assert.ok(actual.includes(item), msg || `Expected string to contain "${item}"`);
      } else if (Array.isArray(actual)) {
        assert.ok(actual.includes(item), msg || `Expected array to contain item`);
      } else {
        assert.ok(item in actual, msg || `Expected object to contain key "${item}"`);
      }
    },
    toNotContain: (item, msg) => {
      if (typeof actual === "string") {
        assert.ok(!actual.includes(item), msg || `Expected string not to contain "${item}"`);
      } else if (Array.isArray(actual)) {
        assert.ok(!actual.includes(item), msg || `Expected array not to contain item`);
      } else {
        assert.ok(!(item in actual), msg || `Expected object not to contain key "${item}"`);
      }
    },
    toMatch: (regex, msg) => assert.match(actual, regex, msg),
    toHaveLength: (len, msg) => assert.equal(actual.length, len, msg),
    toThrow: (expected) => {
      if (typeof actual === "function") {
        assert.throws(actual, expected);
      } else {
        assert.fail("expect(fn).toThrow() requires fn to be a function");
      }
    },
    toNotThrow: () => {
      if (typeof actual === "function") {
        assert.doesNotThrow(actual);
      }
    },
  };

  matchers.not = {
    toBe: (expected, msg) => assert.notEqual(actual, expected, msg),
    toEqual: (expected, msg) => assert.notDeepEqual(actual, expected, msg),
    toBeTruthy: (msg) => assert.ok(!Boolean(actual), msg),
    toBeFalsy: (msg) => assert.ok(Boolean(actual), msg),
    toBeUndefined: (msg) => assert.notEqual(actual, undefined, msg),
    toBeDefined: (msg) => assert.equal(actual, undefined, msg),
    toContain: (item, msg) => matchers.toNotContain(item, msg),
    toNotContain: (item, msg) => matchers.toContain(item, msg),
    toThrow: () => {
      if (typeof actual === "function") {
        assert.doesNotThrow(actual);
      }
    },
  };

  return matchers;
};
