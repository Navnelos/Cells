// The picture, per pixel, on the GPU.
//
// Each pixel finds its three nearest seeds in power distance (weighted partition, shared
// walls). The distance to the walls is combined with a smooth minimum, which rounds every
// junction the same way: cavities get broad, flowing outlines, and the rounding zone at
// a junction between cavities is filled with fan lines (iso-lines of that same field).
// Foam cells are filled with a micro partition computed the same way at a small scale,
// coloured by smooth spatial colour fields sampled once per micro-cell.

export const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`

export const FRAG = `#version 300 es
precision highp float;
out vec4 outColor;

uniform sampler2D uSeeds;   // RGBA32F: x, y, r, kind
uniform int uCount;
uniform vec3 uLobes[24];
uniform int uLobeN;
uniform vec2 uRes;          // canvas size, px
uniform vec3 uView;         // unit, ox, oy (px)
uniform vec4 uCrop;         // x, y, w, h (px, top-left origin)
uniform float uPx;          // plate units per "1000px-frame pixel"
uniform float uDevPx;       // plate units per device pixel (antialiasing)
uniform vec2 uHub;
uniform float uSeed;

uniform float uStrand;      // strand width (frame px)
uniform float uWebs;        // fan reach
uniform float uGlow;
uniform float uFoamScale;   // micro-cell size (plate units)
uniform float uOpen;
uniform vec4 uMix;          // lime, green, blue, lace weights
uniform float uFlat;
uniform float uBand;        // foam band between cavities and the edge
uniform float uGrid;
uniform float uTransparent;

uniform vec3 cBg, cStrand, cHub, cLime, cGreen, cBlue, cLace, cGrid;

// ---- noise -------------------------------------------------------------------------------
vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))) + uSeed;
  return fract(sin(p) * 43758.5453);
}
float hash1(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1)) + uSeed * 1.7) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash1(i), b = hash1(i + vec2(1, 0)), c = hash1(i + vec2(0, 1)), d = hash1(i + vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}
float fbm(vec2 p) { return 0.6 * vnoise(p) + 0.3 * vnoise(p * 2.03 + 17.0) + 0.1 * vnoise(p * 4.1 - 9.0); }

float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

float shapeSDF(vec2 p) {
  float d = 1e9;
  for (int i = 0; i < 24; i++) {
    if (i >= uLobeN) break;
    d = smin(d, length(p - uLobes[i].xy) - uLobes[i].z, 0.08);
  }
  return d;
}

vec4 seedAt(int i) { return texelFetch(uSeeds, ivec2(i, 0), 0); }

// micro partition: three nearest jittered points of a grid, with rounded holes
// returns: x = rounded wall distance (plate units), y = cell id hash, zw = cell point
vec4 micro(vec2 p, float scale) {
  vec2 q = p / scale;
  vec2 ip = floor(q);
  float d1 = 1e9, d2 = 1e9, d3 = 1e9;
  vec2 c1 = vec2(0), c2 = vec2(0), c3 = vec2(0);
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    vec2 g = ip + vec2(i, j);
    vec2 c = g + 0.15 + 0.7 * hash2(g);
    float d = dot(q - c, q - c);
    if (d < d1) { d3 = d2; c3 = c2; d2 = d1; c2 = c1; d1 = d; c1 = c; }
    else if (d < d2) { d3 = d2; c3 = c2; d2 = d; c2 = c; }
    else if (d < d3) { d3 = d; c3 = c; }
  }
  float b12 = dot(q - 0.5 * (c1 + c2), normalize(c1 - c2));
  float b13 = dot(q - 0.5 * (c1 + c3), normalize(c1 - c3));
  float w = smin(b12, b13, 0.22) * scale;
  return vec4(w, hash1(c1 * 1.31), c1 * scale);
}

void main() {
  vec2 fc = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  // outside the frame
  if (fc.x < uCrop.x || fc.y < uCrop.y || fc.x > uCrop.x + uCrop.z || fc.y > uCrop.y + uCrop.w) {
    outColor = vec4(0.047, 0.047, 0.055, 1.0);
    return;
  }
  vec2 p = (fc - uView.yz) / uView.x;
  float aa = uDevPx;

  // ---- background and grid ----
  vec3 col = cBg;
  float alpha = 1.0 - uTransparent;
  if (uGrid > 0.5) {
    float sp = uCrop.w / 11.0;
    vec2 g = (fc - (uCrop.xy + uCrop.zw * 0.5)) / sp;
    vec2 gd = abs(g - floor(g + 0.5)) * sp;
    float line = 1.0 - smoothstep(0.0, 1.0, min(gd.x, gd.y) - 0.5 * uCrop.w / 1000.0);
    float dotm = 1.0 - smoothstep(1.0, 2.2, length(gd) * 1000.0 / uCrop.w);
    col = mix(col, cGrid, 0.28 * line);
    col = mix(col, cGrid, 0.95 * dotm);
    alpha = max(alpha, max(0.28 * line, 0.95 * dotm));
  }

  float B = shapeSDF(p);
  float inside = 1.0 - smoothstep(-aa, aa, B);
  if (inside <= 0.0) { outColor = vec4(col, alpha); return; }

  // ---- nearest three seeds in power distance ----
  float pd1 = 1e9, pd2 = 1e9, pd3 = 1e9;
  int i1 = 0, i2 = 0, i3 = 0;
  for (int i = 0; i < 640; i++) {
    if (i >= uCount) break;
    vec4 s = seedAt(i);
    vec2 d = p - s.xy;
    float pd = dot(d, d) - s.z * s.z;
    if (pd < pd1) { pd3 = pd2; i3 = i2; pd2 = pd1; i2 = i1; pd1 = pd; i1 = i; }
    else if (pd < pd2) { pd3 = pd2; i3 = i2; pd2 = pd; i2 = i; }
    else if (pd < pd3) { pd3 = pd; i3 = i; }
  }
  vec4 s1 = seedAt(i1), s2 = seedAt(i2), s3 = seedAt(i3);
  float d12 = (pd2 - pd1) / (2.0 * max(1e-6, length(s2.xy - s1.xy)));
  float d13 = (pd3 - pd1) / (2.0 * max(1e-6, length(s3.xy - s1.xy)));

  float depth = -B;
  // foam band along the edge: its width wanders, nearly vanishing in places
  float band = uBand * max(0.0, 0.35 + 1.1 * fbm(p * 2.4 + 5.0));
  float de = depth - band;

  float hw = 0.5 * uStrand * uPx;
  float k = s1.z * 0.55 * max(0.05, uWebs);
  float raw = min(min(d12, d13), de);
  float w = smin(smin(d12, d13, k), de, k);

  float hubT = clamp(uGlow * exp(-dot(p - uHub, p - uHub) / 0.09), 0.0, 1.0);
  vec3 strandCol = mix(cStrand, cHub, hubT);

  bool cav1 = s1.w < 0.5;
  bool cav2 = s2.w < 0.5;
  bool cav3 = s3.w < 0.5;

  vec3 shape;
  if (cav1 && w > hw) {
    // cavity interior
    shape = cBg;
  } else if (cav1 && raw > hw && cav2 && (cav3 || d13 > d12 * 3.0) && de > 0.0) {
    // junction between cavities: fan lines (iso-lines of the rounded field)
    float t = (hw - w) / (k * 0.25 + hw);
    float n = 7.0 + 5.0 * hubT;
    float f = abs(fract(t * n) - 0.5) * 2.0;
    float lineW = clamp(aa / ((k * 0.25 + hw) / n) * 1.6, 0.05, 1.0);
    float l = 1.0 - smoothstep(1.0 - lineW, 1.0, f);
    vec3 webBase = mix(cBg, cStrand, 0.12 + 0.2 * hubT);
    shape = mix(webBase, strandCol, l * (0.45 + 0.4 * hubT));
  } else if (cav1 && raw <= hw && (cav2 || de < hw)) {
    // the strand itself (between cavities, or a cavity reaching the edge band)
    shape = strandCol;
  } else {
    // ---- foam: micro partition coloured by spatial colour fields ----
    float sc = uFoamScale * (vnoise(p * 2.6 + 40.0) > 0.1 ? 1.0 : 0.62); // two scales, clusters of each
    vec4 m = micro(p, sc);
    vec2 cp = m.zw;
    // colour field, sampled once per micro-cell so cells are coloured as units
    float f1 = fbm(cp * 3.2 + 11.0), f2 = fbm(cp * 4.3 - 23.0), f3 = fbm(cp * 2.7 + 61.0);
    float rel = clamp(depth / 0.35, 0.0, 1.0);
    vec4 wts = uMix * vec4(1.0 + 1.2 * f1, 1.0 - f1 + 0.6 * f2, -0.4 + 4.0 * f3, 0.2 + rel * 1.0 + 1.2 * f2);
    wts = max(wts, 0.0);
    int st = 0;
    float best = wts.x;
    if (wts.y > best) { st = 1; best = wts.y; }
    if (wts.z > best) { st = 2; best = wts.z; }
    if (wts.w > best) { st = 3; best = wts.w; }
    // cells beside a cavity tend to be lace
    if ((!cav1 || cav2) && min(d12, d13) < 0.03 && fbm(cp * 5.0 + 3.0) > 0.15) st = 3;
    if (f3 > 0.36 && uMix.z > 0.0) st = 2;

    float tone = m.y;
    vec3 wall;
    vec3 hole;
    float openP;
    float wallW;
    if (st == 0) {
      wall = tone < 0.33 ? mix(cLime, cGreen, 0.45) : tone < 0.7 ? cLime : mix(cLime, vec3(0.98, 0.97, 0.3), 0.15);
      hole = mix(cLime, cBg, 0.72); openP = 0.3 * uOpen; wallW = 0.22;
    } else if (st == 1) {
      wall = tone < 0.4 ? mix(cGreen, cBg, 0.25) : cGreen;
      hole = mix(cGreen, cBg, 0.86); openP = uOpen; wallW = 0.16;
    } else if (st == 2) {
      wall = cBlue; hole = mix(cBlue, cBg, 0.75); openP = 0.6 * uOpen; wallW = 0.18;
    } else {
      wall = mix(cLace, cBg, 0.12); hole = cBg; openP = 1.0; wallW = 0.022;
    }
    if (st == 3) {
      float lsc = sc * (fbm(cp * 6.0) > 0.0 ? 2.2 : 1.4);
      m = micro(p + 0.37, lsc);
      sc = lsc;
    }
    float isOpen = step(m.y * 0.999 + 0.0005, openP) * (1.0 - uFlat);
    float holeMask = smoothstep(wallW * sc - aa, wallW * sc + aa, m.x);
    shape = mix(wall, hole, isOpen * holeMask);
    if (st == 3 && uFlat < 0.5) shape = mix(mix(cGreen, cBg, 0.6), shape, 1.0);
    // a cavity's strand still shows where foam presses against it
    if (cav2 && !cav1 && abs(d12) < hw * 1.2) shape = mix(shape, strandCol, 0.9);
  }
  col = mix(col, shape, inside);
  outColor = vec4(col, max(alpha, inside));
}
`
