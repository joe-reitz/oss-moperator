// Green-phosphor digital rain, lit by the ASCII logo. The `light` field is a
// CPU-blurred rasterization of the on-screen logo: it adds a halo, and rain
// glyphs brighten as they fall through the ring of light around the mark
// (dimming again right at the core so the DOM logo stays legible).
struct Params {
  time: f32,
  aspect: f32,
  mouse: vec2f,
  glow: f32,
}
const LIGHT_SIZE = vec2u(512, 288);
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> light: array<f32>;

fn light_index(p: vec2i) -> u32 {
  let q = clamp(p, vec2i(0), vec2i(LIGHT_SIZE) - 1);
  return u32(q.y) * LIGHT_SIZE.x + u32(q.x);
}

fn sample_light(p: vec2f) -> f32 {
  let coord = clamp(p * vec2f(LIGHT_SIZE) - 0.5, vec2f(0), vec2f(LIGHT_SIZE) - 1.0);
  let cell = vec2i(floor(coord));
  let f = fract(coord);
  let bottom = mix(light[light_index(cell)], light[light_index(cell + vec2i(1, 0))], f.x);
  let top = mix(light[light_index(cell + vec2i(0, 1))], light[light_index(cell + vec2i(1, 1))], f.x);
  return mix(bottom, top, f.y);
}

fn hash11(p: f32) -> f32 {
  var x = fract(p * 0.1031);
  x = x * (x + 33.33);
  x = x * (x + x);
  return fract(x);
}

fn hash21(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + vec3f(33.33));
  return fract((p3.x + p3.y) * p3.z);
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let cols = 90.0;
  let cellW = 1.0 / cols;
  let cellH = cellW * params.aspect * 1.6;

  let col = floor(uv.x / cellW);
  let row = floor(uv.y / cellH);
  let seed = hash11(col + 1.0);

  // Falling head per column; uv is top-origin so v grows downward.
  let speed = 0.06 + seed * 0.18;
  let head = fract(seed * 9.7 + params.time * speed);
  let d = fract(head - uv.y);
  let trail = pow(clamp(1.0 - d * (2.0 + seed * 3.0), 0.0, 1.0), 2.0);
  let isHead = smoothstep(cellH * 2.0, 0.0, d);

  // Glyph: random dot pattern on a 3x4 sub-grid with a 1-dot margin,
  // re-rolled on a per-cell cadence so characters appear to change.
  let cellUv = vec2f(fract(uv.x / cellW), fract(uv.y / cellH));
  let sub = floor(cellUv * vec2f(4.0, 6.0));
  var glyph = 0.0;
  if (sub.x > 0.0 && sub.x < 3.0 && sub.y > 0.0 && sub.y < 5.0) {
    let epoch = floor(params.time * (1.0 + seed * 3.0) + hash21(vec2f(col, row)) * 8.0);
    glyph = step(0.42, hash21(vec2f(col * 31.0 + sub.x, row * 17.0 + sub.y + epoch * 13.0)));
  }

  // Pointer glow, measured in height units.
  let md = length(vec2f((uv.x - params.mouse.x) * params.aspect, uv.y - params.mouse.y));
  let glow = exp(-md * md * 24.0) * params.glow;

  // Fade at the edges so the effect melts into the page.
  let fade = smoothstep(0.0, 0.1, uv.x) * smoothstep(1.0, 0.9, uv.x)
    * smoothstep(0.0, 0.14, uv.y) * smoothstep(1.0, 0.82, uv.y);

  let logoLight = sample_light(uv);
  // Rain lights up in the ring around the logo, dims again at its core.
  let ring = 4.0 * logoLight * (1.0 - logoLight);
  let coreDim = 1.0 - 0.6 * smoothstep(0.55, 1.0, logoLight);

  let flicker = 0.3 + 0.7 * hash21(vec2f(col, row + floor(params.time * 3.0)));
  let intensity = trail * flicker * glyph;

  let base = vec3f(0.3, 1.0, 0.5);
  var color = base * intensity * 0.3 * (1.0 + 1.6 * ring) * coreDim;
  color += vec3f(0.75, 1.0, 0.85) * glyph * isHead * trail * 0.5 * coreDim;
  color *= 1.0 + 2.6 * glow;
  // The halo the logo casts, independent of the rain.
  color += vec3f(0.16, 0.9, 0.34) * pow(logoLight, 1.4) * 0.24;
  color += base * glow * 0.04;
  color *= fade;

  return vec4f(color, 1.0);
}
