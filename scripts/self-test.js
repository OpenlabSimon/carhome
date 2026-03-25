import { analyzeImageData } from "../public/js/analyzer-core.js";
import { buildFixturePayload, createFixtureScenes, FIXTURE_HEIGHT, FIXTURE_WIDTH } from "../lib/test-image-fixtures.js";

function analyzeCase(name, data) {
  return analyzeImageData({
    data,
    width: FIXTURE_WIDTH,
    height: FIXTURE_HEIGHT,
    imageName: `${name}.png`,
    mimeType: "image/png",
    fileSize: data.length,
    originalWidth: FIXTURE_WIDTH,
    originalHeight: FIXTURE_HEIGHT
  });
}

function assertIncludes(result, issueType) {
  if (!result.issue_types.includes(issueType)) {
    throw new Error(`${result.image.name}: expected issue "${issueType}" but got [${result.issue_types.join(", ")}]`);
  }
}

function assertExcludes(result, issueType) {
  if (result.issue_types.includes(issueType)) {
    throw new Error(`${result.image.name}: expected no issue "${issueType}" but got [${result.issue_types.join(", ")}]`);
  }
}

const scenes = createFixtureScenes();
const results = [
  analyzeCase("normal", scenes.normal),
  analyzeCase("overexposed", scenes.overexposed),
  analyzeCase("underexposed", scenes.underexposed),
  analyzeCase("blurred", scenes.blurred),
  analyzeCase("cluttered", scenes.cluttered),
  analyzeCase("composition", scenes.composition)
];

const normal = results[0];
if (normal.has_issue) {
  throw new Error(`normal.png should pass initial screening, got [${normal.issue_types.join(", ")}]`);
}

assertIncludes(results[1], "过曝");
assertIncludes(results[2], "偏暗");
assertIncludes(results[3], "虚图 / 模糊");
assertIncludes(results[4], "背景杂乱");
assertIncludes(results[5], "构图异常");
assertExcludes(results[0], "过曝");
assertExcludes(results[0], "偏暗");

const sampleFixture = buildFixturePayload("overexposed");

for (const result of results) {
  console.log(
    `${result.image.name} | has_issue=${result.has_issue} | issue_types=${result.issue_types.join(", ") || "none"} | confidence=${result.confidence}`
  );
}

console.log(
  `fixture_ready | image=${sampleFixture.imageName} | mime=${sampleFixture.mimeType} | size=${sampleFixture.fileSize}B | width=${sampleFixture.width} | height=${sampleFixture.height}`
);
