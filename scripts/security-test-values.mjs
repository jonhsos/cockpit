const repeat = (character, count) => character.repeat(count);

export const TEST_SECRET_VALUES = Object.freeze({
  anthropicApi03: ["sk", "ant", "api03", "fixture", repeat("a", 32)].join("-"),
  anthropicAdmin01: ["sk", "ant", "admin01", "fixture", repeat("b", 32)].join("-"),
  openAiProject: ["sk", "proj", "fixture", repeat("c", 32)].join("-"),
  openAiAdmin: ["sk", "admin", "fixture", repeat("d", 32)].join("-"),
  openRouter: ["sk", "or", "v1", repeat("e", 48)].join("-"),
  google: `AIza${repeat("f", 35)}`,
  bearer: ["Bearer", ["fixture", "bearer", repeat("g", 24)].join("-")].join(" "),
  jwt: ["fixture-header", "fixture-payload", "fixture-signature"].join("."),
  custom: ["fixture", "registered", "secret", repeat("h", 12)].join("_"),
  genericToken: ["fixture", "token", repeat("i", 24)].join("-"),
  deepseekApiKey: ["fixture", "deepseek", "api", repeat("j", 16)].join("-"),
  oauthAccessToken: ["ya29", "fixture", "access", repeat("k", 20)].join("_"),
  oauthRefreshToken: ["fixture", "refresh", "token", repeat("l", 20)].join("-"),
});
