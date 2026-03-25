export const ISSUE_DEFINITIONS = {
  "过曝": "整体亮度偏高，车身细节丢失、发白",
  "偏暗": "画面整体亮度不足，车身轮廓与细节看不清",
  "虚图 / 模糊": "焦点不实或画面模糊，细节不清晰",
  "背景杂乱": "背景杂物过多，干扰车辆主体展示",
  "构图异常": "拍摄角度不正、画面倾斜，或存在透视畸变"
};

export const ISSUE_TYPES = Object.keys(ISSUE_DEFINITIONS);

export const ANALYZER_INFO = {
  name: "heuristic-canvas-analyzer",
  type: "rule-based",
  version: "0.2.0"
};

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const round = (value, digits = 4) => Number(value.toFixed(digits));
const normalize = (value, min, max) => {
  if (max <= min) {
    return value >= max ? 1 : 0;
  }

  return clamp01((value - min) / (max - min));
};

const inverseNormalize = (value, min, max) => {
  if (max <= min) {
    return value <= min ? 1 : 0;
  }

  return clamp01((max - value) / (max - min));
};

const ratioToPercent = (value, digits = 1) => `${(value * 100).toFixed(digits)}%`;

function computeStd(sum, sumSquares, count) {
  if (count <= 0) {
    return 0;
  }

  const mean = sum / count;
  return Math.sqrt(Math.max(0, sumSquares / count - mean * mean));
}

function computeEntropy(histogram, total) {
  if (!total) {
    return 0;
  }

  let entropy = 0;

  for (const count of histogram) {
    if (!count) {
      continue;
    }

    const probability = count / total;
    entropy -= probability * Math.log2(probability);
  }

  return entropy;
}

function buildIssue(issueType, score, threshold, definition, reason, evidence) {
  const hit = score >= threshold;
  const severity = !hit ? "none" : score >= 0.82 ? "high" : score >= 0.68 ? "medium" : "low";

  return {
    issue_type: issueType,
    definition,
    hit,
    score: round(score, 3),
    threshold: round(threshold, 3),
    severity,
    reason,
    evidence
  };
}

function computeMetrics(data, width, height) {
  const pixelCount = width * height;
  const gray = new Float32Array(pixelCount);

  const borderX = Math.max(1, Math.floor(width * 0.18));
  const borderY = Math.max(1, Math.floor(height * 0.18));
  const centerMinX = Math.floor(width * 0.22);
  const centerMaxX = Math.ceil(width * 0.78);
  const centerMinY = Math.floor(height * 0.22);
  const centerMaxY = Math.ceil(height * 0.78);
  const borderHistogram = new Array(32).fill(0);

  let brightnessSum = 0;
  let brightnessSqSum = 0;
  let borderBrightnessSum = 0;
  let borderBrightnessSqSum = 0;
  let centerBrightnessSum = 0;
  let centerBrightnessSqSum = 0;
  let borderPixelCount = 0;
  let centerPixelCount = 0;

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const offset = pixelIndex * 4;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const brightness = red * 0.299 + green * 0.587 + blue * 0.114;
    gray[pixelIndex] = brightness;
    brightnessSum += brightness;
    brightnessSqSum += brightness * brightness;

    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    const isBorder = x < borderX || x >= width - borderX || y < borderY || y >= height - borderY;
    const isCenter = x >= centerMinX && x < centerMaxX && y >= centerMinY && y < centerMaxY;

    if (isBorder) {
      borderBrightnessSum += brightness;
      borderBrightnessSqSum += brightness * brightness;
      borderPixelCount += 1;
      borderHistogram[Math.min(31, Math.floor(brightness / 8))] += 1;
    }

    if (isCenter) {
      centerBrightnessSum += brightness;
      centerBrightnessSqSum += brightness * brightness;
      centerPixelCount += 1;
    }
  }

  const brightnessMean = brightnessSum / pixelCount;
  const brightnessStd = computeStd(brightnessSum, brightnessSqSum, pixelCount);
  const borderBrightnessStd = computeStd(borderBrightnessSum, borderBrightnessSqSum, borderPixelCount);
  const centerBrightnessStd = computeStd(centerBrightnessSum, centerBrightnessSqSum, centerPixelCount);

  let brightPixels = 0;
  let darkPixels = 0;
  let edgeMagnitudeSum = 0;
  let edgeMagnitudeSqSum = 0;
  let strongEdgeCount = 0;
  let borderEdgeCount = 0;
  let centerEdgeCount = 0;
  let borderMagnitudeSum = 0;
  let centerMagnitudeSum = 0;
  let laplacianSum = 0;
  let laplacianSqSum = 0;
  let diagonalEnergy = 0;
  let axisAlignedEnergy = 0;
  let orientationEnergy = 0;
  let weightedX = 0;
  let weightedY = 0;
  let weightedEnergy = 0;
  let interiorPixels = 0;
  let borderInteriorPixels = 0;
  let centerInteriorPixels = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const center = gray[index];

      if (center >= 245) {
        brightPixels += 1;
      } else if (center <= 35) {
        darkPixels += 1;
      }

      const gx =
        -gray[index - width - 1] +
        gray[index - width + 1] +
        -2 * gray[index - 1] +
        2 * gray[index + 1] +
        -gray[index + width - 1] +
        gray[index + width + 1];

      const gy =
        -gray[index - width - 1] +
        -2 * gray[index - width] +
        -gray[index - width + 1] +
        gray[index + width - 1] +
        2 * gray[index + width] +
        gray[index + width + 1];

      const magnitude = Math.hypot(gx, gy);
      const laplacian =
        4 * center - gray[index - 1] - gray[index + 1] - gray[index - width] - gray[index + width];

      edgeMagnitudeSum += magnitude;
      edgeMagnitudeSqSum += magnitude * magnitude;
      laplacianSum += laplacian;
      laplacianSqSum += laplacian * laplacian;
      interiorPixels += 1;

      const isBorder = x < borderX || x >= width - borderX || y < borderY || y >= height - borderY;
      const isCenter = x >= centerMinX && x < centerMaxX && y >= centerMinY && y < centerMaxY;

      if (magnitude >= 96) {
        strongEdgeCount += 1;
        if (isBorder) {
          borderEdgeCount += 1;
        }
        if (isCenter) {
          centerEdgeCount += 1;
        }
      }

      if (isBorder) {
        borderMagnitudeSum += magnitude;
        borderInteriorPixels += 1;
      }

      if (isCenter) {
        centerMagnitudeSum += magnitude;
        centerInteriorPixels += 1;
      }

      if (magnitude >= 120) {
        weightedEnergy += magnitude;
        weightedX += x * magnitude;
        weightedY += y * magnitude;

        const gradientAngle = (Math.atan2(gy, gx) * 180) / Math.PI;
        const lineAngle = (gradientAngle + 270) % 180;
        const axisDistance = Math.min(
          Math.abs(lineAngle - 0),
          Math.abs(lineAngle - 90),
          Math.abs(lineAngle - 180)
        );
        const diagonalDistance = Math.min(Math.abs(lineAngle - 45), Math.abs(lineAngle - 135));

        orientationEnergy += magnitude;
        if (axisDistance <= 18) {
          axisAlignedEnergy += magnitude;
        }
        if (diagonalDistance <= 18) {
          diagonalEnergy += magnitude;
        }
      }
    }
  }

  const edgeMean = edgeMagnitudeSum / interiorPixels;
  const edgeDensity = strongEdgeCount / interiorPixels;
  const borderEdgeDensity = borderInteriorPixels ? borderEdgeCount / borderInteriorPixels : 0;
  const centerEdgeDensity = centerInteriorPixels ? centerEdgeCount / centerInteriorPixels : 0;
  const laplacianVariance = Math.max(0, laplacianSqSum / interiorPixels - (laplacianSum / interiorPixels) ** 2);
  const sharpnessIndex = laplacianVariance / (brightnessStd + 1);
  const edgeCenterX = weightedEnergy ? weightedX / weightedEnergy / (width - 1) : 0.5;
  const edgeCenterY = weightedEnergy ? weightedY / weightedEnergy / (height - 1) : 0.5;
  const edgeCenterOffset = Math.hypot(edgeCenterX - 0.5, edgeCenterY - 0.5);
  const borderEnergyRatio = edgeMagnitudeSum ? borderMagnitudeSum / edgeMagnitudeSum : 0;
  const diagonalRatio = orientationEnergy ? diagonalEnergy / orientationEnergy : 0;
  const axisAlignedRatio = orientationEnergy ? axisAlignedEnergy / orientationEnergy : 0;
  const borderEntropy = computeEntropy(borderHistogram, borderPixelCount);
  const borderToCenterEdgeRatio =
    centerEdgeDensity > 0.00001 ? borderEdgeDensity / centerEdgeDensity : borderEdgeDensity > 0 ? 99 : 0;

  return {
    width,
    height,
    pixelCount,
    brightnessMean,
    brightnessStd,
    brightRatio: brightPixels / interiorPixels,
    darkRatio: darkPixels / interiorPixels,
    borderBrightnessStd,
    centerBrightnessStd,
    edgeMean,
    edgeDensity,
    borderEdgeDensity,
    centerEdgeDensity,
    borderEntropy,
    borderToCenterEdgeRatio,
    laplacianVariance,
    sharpnessIndex,
    borderEnergyRatio,
    edgeCenterX,
    edgeCenterY,
    edgeCenterOffset,
    diagonalRatio,
    axisAlignedRatio
  };
}

export function analyzeImageData({
  data,
  width,
  height,
  imageName = "uploaded-image",
  mimeType = "image/unknown",
  fileSize = null,
  originalWidth = width,
  originalHeight = height
}) {
  if (!data || !width || !height) {
    throw new Error("Image data is required.");
  }

  const metrics = computeMetrics(data, width, height);
  const overexposedScore =
    normalize(metrics.brightnessMean, 178, 238) * 0.56 +
    normalize(metrics.brightRatio, 0.04, 0.28) * 0.34 +
    inverseNormalize(metrics.brightnessStd, 28, 72) * 0.1;

  const mixedLightingPenalty =
    normalize(metrics.brightRatio, 0.025, 0.09) * 0.16 +
    normalize(metrics.edgeCenterOffset, 0.12, 0.2) * 0.1 +
    normalize(metrics.brightnessStd, 50, 76) * 0.12;
  const darkScore = clamp01(
    inverseNormalize(metrics.brightnessMean, 48, 112) * 0.56 +
      normalize(metrics.darkRatio, 0.08, 0.38) * 0.34 +
      inverseNormalize(metrics.brightnessStd, 18, 56) * 0.1 -
      mixedLightingPenalty
  );

  const blurBaseScore =
    inverseNormalize(metrics.laplacianVariance, 120, 1500) * 0.65 +
    inverseNormalize(metrics.edgeDensity, 0.04, 0.12) * 0.2 +
    inverseNormalize(metrics.edgeMean, 18, 58) * 0.15;
  const blurSuppression = Math.max(0.25, 1 - Math.max(overexposedScore, darkScore) * 0.55);
  const blurScore = clamp01(blurBaseScore * blurSuppression);

  const clutterPenalty =
    normalize(metrics.edgeCenterOffset, 0.04, 0.11) * 0.16 +
    normalize(metrics.centerEdgeDensity, 0.34, 0.44) * 0.08;
  const clutterScore = clamp01(
    normalize(metrics.borderEdgeDensity, 0.06, 0.22) * 0.5 +
      normalize(metrics.borderToCenterEdgeRatio, 1.0, 1.55) * 0.25 +
      normalize(metrics.borderEntropy, 2.5, 4.8) * 0.15 +
      normalize(metrics.borderBrightnessStd, 18, 54) * 0.1 -
      clutterPenalty
  );

  const skewDominance = Math.max(0, metrics.diagonalRatio - metrics.axisAlignedRatio * 0.15);
  const compositionGate = 0.55 + normalize(metrics.centerEdgeDensity, 0.14, 0.24) * 0.45;
  const compositionPenalty =
    normalize(metrics.brightRatio, 0.03, 0.09) * 0.08 +
    normalize(metrics.darkRatio, 0.45, 0.7) * 0.05;
  const compositionScore = clamp01(
    (normalize(skewDominance, 0.04, 0.18) * 0.25 +
      normalize(metrics.edgeCenterOffset, 0.07, 0.18) * 0.55 +
      normalize(metrics.borderEnergyRatio, 0.2, 0.42) * 0.2) *
      compositionGate -
      compositionPenalty
  );

  const issueDetails = [
    buildIssue(
      "过曝",
      overexposedScore,
      0.62,
      ISSUE_DEFINITIONS["过曝"],
      `整体亮度偏高，亮部像素占比 ${ratioToPercent(metrics.brightRatio)}，存在车身细节发白风险。`,
      {
        brightness_mean: round(metrics.brightnessMean, 2),
        bright_ratio: round(metrics.brightRatio, 4),
        brightness_std: round(metrics.brightnessStd, 2)
      }
    ),
    buildIssue(
      "偏暗",
      darkScore,
      0.69,
      ISSUE_DEFINITIONS["偏暗"],
      `画面整体偏暗，暗部像素占比 ${ratioToPercent(metrics.darkRatio)}，车身轮廓与细节可能不清晰。`,
      {
        brightness_mean: round(metrics.brightnessMean, 2),
        dark_ratio: round(metrics.darkRatio, 4),
        brightness_std: round(metrics.brightnessStd, 2),
        mixed_lighting_penalty: round(mixedLightingPenalty, 3)
      }
    ),
    buildIssue(
      "虚图 / 模糊",
      blurScore,
      0.64,
      ISSUE_DEFINITIONS["虚图 / 模糊"],
      `拉普拉斯方差偏低（${round(metrics.laplacianVariance, 1)}），边缘细节不足，疑似虚图或整体模糊。`,
      {
        laplacian_variance: round(metrics.laplacianVariance, 2),
        sharpness_index: round(metrics.sharpnessIndex, 2),
        edge_density: round(metrics.edgeDensity, 4),
        edge_mean: round(metrics.edgeMean, 2)
      }
    ),
    buildIssue(
      "背景杂乱",
      clutterScore,
      0.68,
      ISSUE_DEFINITIONS["背景杂乱"],
      `边框区域边缘密度较高（${ratioToPercent(metrics.borderEdgeDensity)}），背景信息复杂，可能干扰车辆主体展示。`,
      {
        border_edge_density: round(metrics.borderEdgeDensity, 4),
        center_edge_density: round(metrics.centerEdgeDensity, 4),
        border_entropy: round(metrics.borderEntropy, 3),
        border_to_center_edge_ratio: round(metrics.borderToCenterEdgeRatio, 3),
        clutter_penalty: round(clutterPenalty, 3)
      }
    ),
    buildIssue(
      "构图异常",
      compositionScore,
      0.6,
      ISSUE_DEFINITIONS["构图异常"],
      `主体边缘重心偏移 ${ratioToPercent(metrics.edgeCenterOffset * 1.8)}，且斜线占比较高，疑似存在倾斜或构图失衡。`,
      {
        edge_center_offset: round(metrics.edgeCenterOffset, 4),
        skew_dominance: round(skewDominance, 4),
        diagonal_ratio: round(metrics.diagonalRatio, 4),
        border_energy_ratio: round(metrics.borderEnergyRatio, 4),
        composition_gate: round(compositionGate, 3),
        composition_penalty: round(compositionPenalty, 3)
      }
    )
  ];

  const hitIssues = issueDetails.filter((item) => item.hit);
  const topScore = issueDetails.reduce((max, item) => Math.max(max, item.score), 0);
  const maxHitScore = hitIssues.reduce((max, item) => Math.max(max, item.score), 0);
  const hasIssue = hitIssues.length > 0;
  const confidence = hasIssue
    ? Math.min(0.98, 0.54 + maxHitScore * 0.42)
    : Math.max(0.56, 0.9 - topScore * 0.36);

  const result = {
    analyzer: ANALYZER_INFO,
    image: {
      name: imageName,
      mime_type: mimeType,
      file_size_bytes: fileSize,
      original_width: originalWidth,
      original_height: originalHeight,
      analyzed_width: width,
      analyzed_height: height
    },
    has_issue: hasIssue,
    issue_types: hitIssues.map((item) => item.issue_type),
    reasons: hitIssues.map((item) => item.reason),
    severity: !hasIssue ? "none" : maxHitScore >= 0.82 ? "high" : maxHitScore >= 0.68 ? "medium" : "low",
    confidence: round(confidence, 3),
    details: issueDetails,
    metrics: {
      brightness_mean: round(metrics.brightnessMean, 2),
      brightness_std: round(metrics.brightnessStd, 2),
      bright_ratio: round(metrics.brightRatio, 4),
      dark_ratio: round(metrics.darkRatio, 4),
      edge_mean: round(metrics.edgeMean, 2),
      edge_density: round(metrics.edgeDensity, 4),
      border_edge_density: round(metrics.borderEdgeDensity, 4),
      center_edge_density: round(metrics.centerEdgeDensity, 4),
      border_entropy: round(metrics.borderEntropy, 3),
      border_to_center_edge_ratio: round(metrics.borderToCenterEdgeRatio, 3),
      laplacian_variance: round(metrics.laplacianVariance, 2),
      sharpness_index: round(metrics.sharpnessIndex, 2),
      border_energy_ratio: round(metrics.borderEnergyRatio, 4),
      edge_center_offset: round(metrics.edgeCenterOffset, 4),
      diagonal_ratio: round(metrics.diagonalRatio, 4),
      axis_aligned_ratio: round(metrics.axisAlignedRatio, 4)
    }
  };

  return result;
}
