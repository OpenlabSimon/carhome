# Changelog

## v0.2.0

Initial open-source MVP release.

### Included

- zero-dependency Node.js HTTP server
- static frontend for single-image analysis
- `heuristic / gemini / hybrid` analyzer modes
- fallback from remote provider back to local heuristic mode
- 5-label audit taxonomy:
  - `过曝`
  - `偏暗`
  - `虚图 / 模糊`
  - `背景杂乱`
  - `构图异常`
- LLM-based scene understanding:
  - `整车外观`
  - `局部外观`
  - `局部内饰`
  - `车辆附件`
- LLM-based metadata extraction:
  - `拍摄角度`
  - `主要部位`
- batch audit script
- batch scene / angle / focus-part classification script
- handoff and model configuration docs

### Notes

- `heuristic` remains the safest default mode for local and low-cost usage.
- `gemini` and `hybrid` are intended for live model evaluation and richer scene understanding.
- no private datasets or real API keys are included in the repository.
