import { deflateSync } from "node:zlib";

export const FIXTURE_WIDTH = 220;
export const FIXTURE_HEIGHT = 140;

function setPixel(data, width, height, x, y, [red, green, blue, alpha = 255]) {
  if (x < 0 || x >= width || y < 0 || y >= height) {
    return;
  }

  const offset = (y * width + x) * 4;
  data[offset] = red;
  data[offset + 1] = green;
  data[offset + 2] = blue;
  data[offset + 3] = alpha;
}

function createCanvas(width, height, fill) {
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      setPixel(data, width, height, x, y, fill);
    }
  }

  return data;
}

function fillRect(data, width, height, xStart, yStart, rectWidth, rectHeight, color) {
  for (let y = yStart; y < yStart + rectHeight; y += 1) {
    for (let x = xStart; x < xStart + rectWidth; x += 1) {
      setPixel(data, width, height, x, y, color);
    }
  }
}

function drawOutline(data, width, height, xStart, yStart, rectWidth, rectHeight, color, thickness = 2) {
  fillRect(data, width, height, xStart, yStart, rectWidth, thickness, color);
  fillRect(data, width, height, xStart, yStart + rectHeight - thickness, rectWidth, thickness, color);
  fillRect(data, width, height, xStart, yStart, thickness, rectHeight, color);
  fillRect(data, width, height, xStart + rectWidth - thickness, yStart, thickness, rectHeight, color);
}

function drawLine(data, width, height, x0, y0, x1, y1, color, thickness = 1) {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  let x = x0;
  let y = y0;

  while (true) {
    for (let offsetY = -Math.floor(thickness / 2); offsetY <= Math.floor(thickness / 2); offsetY += 1) {
      for (let offsetX = -Math.floor(thickness / 2); offsetX <= Math.floor(thickness / 2); offsetX += 1) {
        setPixel(data, width, height, x + offsetX, y + offsetY, color);
      }
    }

    if (x === x1 && y === y1) {
      break;
    }

    const e2 = 2 * error;
    if (e2 >= dy) {
      error += dy;
      x += sx;
    }
    if (e2 <= dx) {
      error += dx;
      y += sy;
    }
  }
}

function addDeterministicNoise(data, width, height, amplitude, borderOnly = false) {
  let seed = 20260324;

  function nextRandom() {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 0xffffffff;
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const isBorder = x < 40 || x >= width - 40 || y < 28 || y >= height - 28;
      if (borderOnly && !isBorder) {
        continue;
      }

      const offset = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const noise = (nextRandom() * 2 - 1) * amplitude;
        data[offset + channel] = Math.max(0, Math.min(255, data[offset + channel] + noise));
      }
    }
  }
}

function boxBlur(data, width, height, passes = 1) {
  let source = new Uint8ClampedArray(data);

  for (let pass = 0; pass < passes; pass += 1) {
    const target = new Uint8ClampedArray(source.length);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let red = 0;
        let green = 0;
        let blue = 0;
        let alpha = 0;
        let count = 0;

        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            const sampleX = Math.max(0, Math.min(width - 1, x + offsetX));
            const sampleY = Math.max(0, Math.min(height - 1, y + offsetY));
            const sampleOffset = (sampleY * width + sampleX) * 4;
            red += source[sampleOffset];
            green += source[sampleOffset + 1];
            blue += source[sampleOffset + 2];
            alpha += source[sampleOffset + 3];
            count += 1;
          }
        }

        const targetOffset = (y * width + x) * 4;
        target[targetOffset] = Math.round(red / count);
        target[targetOffset + 1] = Math.round(green / count);
        target[targetOffset + 2] = Math.round(blue / count);
        target[targetOffset + 3] = Math.round(alpha / count);
      }
    }

    source = target;
  }

  return source;
}

function makeBaseScene({
  background = [188, 191, 196, 255],
  carBody = [118, 131, 150, 255],
  windowColor = [170, 178, 186, 255],
  tireColor = [34, 35, 42, 255],
  accent = [230, 235, 238, 255],
  offsetX = 0,
  offsetY = 0,
  width = FIXTURE_WIDTH,
  height = FIXTURE_HEIGHT
} = {}) {
  const data = createCanvas(width, height, background);
  fillRect(data, width, height, 0, 102, width, 8, [146, 149, 152, 255]);
  fillRect(data, width, height, 44 + offsetX, 56 + offsetY, 124, 34, carBody);
  fillRect(data, width, height, 78 + offsetX, 38 + offsetY, 52, 22, carBody);
  fillRect(data, width, height, 86 + offsetX, 42 + offsetY, 18, 14, windowColor);
  fillRect(data, width, height, 108 + offsetX, 42 + offsetY, 18, 14, windowColor);
  fillRect(data, width, height, 58 + offsetX, 82 + offsetY, 24, 24, tireColor);
  fillRect(data, width, height, 128 + offsetX, 82 + offsetY, 24, 24, tireColor);
  drawOutline(data, width, height, 44 + offsetX, 56 + offsetY, 124, 34, accent, 2);
  drawOutline(data, width, height, 78 + offsetX, 38 + offsetY, 52, 22, accent, 2);
  drawLine(data, width, height, 44 + offsetX, 88 + offsetY, 168 + offsetX, 88 + offsetY, accent, 2);
  return data;
}

export function createFixtureScenes() {
  const normal = makeBaseScene();
  const overexposed = makeBaseScene({
    background: [245, 245, 243, 255],
    carBody: [236, 237, 237, 255],
    windowColor: [223, 225, 228, 255],
    tireColor: [214, 214, 216, 255],
    accent: [255, 255, 255, 255]
  });
  const underexposed = makeBaseScene({
    background: [26, 28, 31, 255],
    carBody: [54, 58, 67, 255],
    windowColor: [84, 95, 105, 255],
    tireColor: [15, 16, 18, 255],
    accent: [94, 98, 104, 255]
  });
  const blurred = boxBlur(normal, FIXTURE_WIDTH, FIXTURE_HEIGHT, 5);
  const cluttered = makeBaseScene();
  addDeterministicNoise(cluttered, FIXTURE_WIDTH, FIXTURE_HEIGHT, 42, true);

  for (let x = 8; x < FIXTURE_WIDTH - 8; x += 24) {
    drawLine(cluttered, FIXTURE_WIDTH, FIXTURE_HEIGHT, x, 12, x + 12, 36, [78, 122, 64, 255], 3);
    drawLine(
      cluttered,
      FIXTURE_WIDTH,
      FIXTURE_HEIGHT,
      x + 10,
      FIXTURE_HEIGHT - 36,
      x + 20,
      FIXTURE_HEIGHT - 12,
      [172, 74, 58, 255],
      3
    );
  }

  const composition = makeBaseScene({ offsetX: -34, offsetY: 10 });
  drawLine(composition, FIXTURE_WIDTH, FIXTURE_HEIGHT, 18, 18, 118, 108, [241, 210, 118, 255], 4);
  drawLine(composition, FIXTURE_WIDTH, FIXTURE_HEIGHT, 40, 12, 184, 124, [84, 108, 168, 255], 4);
  drawLine(composition, FIXTURE_WIDTH, FIXTURE_HEIGHT, 162, 18, 92, 124, [178, 87, 72, 255], 3);

  return {
    blurred,
    cluttered,
    composition,
    normal,
    overexposed,
    underexposed
  };
}

function makeCrcTable() {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }

  return table;
}

const CRC_TABLE = makeCrcTable();

function crc32(buffer) {
  let value = 0xffffffff;

  for (const byte of buffer) {
    value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }

  return (value ^ 0xffffffff) >>> 0;
}

function encodeChunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, "ascii");
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

export function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const rawRows = Buffer.alloc((stride + 1) * height);
  const rgbaBuffer = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (stride + 1);
    rawRows[rowOffset] = 0;
    rgbaBuffer.copy(rawRows, rowOffset + 1, y * stride, y * stride + stride);
  }

  const compressed = deflateSync(rawRows, { level: 9 });
  return Buffer.concat([signature, encodeChunk("IHDR", ihdr), encodeChunk("IDAT", compressed), encodeChunk("IEND")]);
}

export function buildFixturePayload(name) {
  const scenes = createFixtureScenes();
  const rgba = scenes[name];
  if (!rgba) {
    throw new Error(`Unknown fixture: ${name}`);
  }

  const png = encodePng(FIXTURE_WIDTH, FIXTURE_HEIGHT, rgba);
  const rgbaBuffer = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);

  return {
    fileSize: png.length,
    height: FIXTURE_HEIGHT,
    imageName: `${name}.png`,
    mimeType: "image/png",
    originalBase64: png.toString("base64"),
    originalBuffer: png,
    originalHeight: FIXTURE_HEIGHT,
    originalWidth: FIXTURE_WIDTH,
    rgba,
    rgbaBase64: rgbaBuffer.toString("base64"),
    width: FIXTURE_WIDTH
  };
}
