// Each field bends continuously; grain stays fixed so motion reads as fabric, not static.
export const textureFragmentShader = `
precision highp float;
uniform vec2 resolution;
uniform float time;
uniform float light;
uniform int variant;
uniform float seed;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  f = f * f * (3. - 2. * f);
  return mix(mix(hash(cell), hash(cell + vec2(1., 0.)), f.x),
    mix(hash(cell + vec2(0., 1.)), hash(cell + vec2(1.)), f.x), f.y);
}
float fbm(vec2 p) {
  float sum = 0.;
  float amplitude = .5;
  for (int i = 0; i < 4; i++) {
    sum += amplitude * noise(p);
    p = mat2(.8, .6, -.6, .8) * p * 2.03 + vec2(3.2, 1.7);
    amplitude *= .5;
  }
  return sum;
}
vec3 silk(vec2 p, float t) {
  vec2 q = p;
  q.x += .22 * sin(p.y * 4. + t * .7) + .13 * cos(p.y * 8. - t * .5);
  q.y += .18 * sin(p.x * 3. - t) + .06 * cos(p.x * 9. + t * .8);
  float field = q.y + .20 * sin(q.x * 2.8 + t * .5) + .10 * sin(q.x * 6. - t * .6);
  float ribbon = exp(-pow((field - .16) / .19, 2.));
  float fold = .5 + .5 * sin(field * 24. + q.x * 2. - t * 1.5);
  float sheen = pow(fold, 5.) * ribbon;
  float threads = .5 + .5 * sin(field * 580. + sin(q.x * 24.) * .6);
  vec3 green = mix(vec3(.25, .49, .36), vec3(-.37, -.23, -.32), light);
  vec3 peach = mix(vec3(.65, .43, .29), vec3(-.16, -.28, -.38), light);
  vec3 tint = mix(green, peach, smoothstep(.08, .8, q.x));
  vec3 color = tint * (ribbon * .25 + sheen * .8) * (.72 + threads * .28);
  float glint = pow(fold, 18.) * ribbon * (.5 + .5 * sin(q.x * 3. + t));
  color += mix(vec3(.25, .28, .20), vec3(-.12, -.12, -.1), light) * glint * .3;
  color += mix(vec3(.045, .08, .055), vec3(-.025, -.012, -.02), light)
    * exp(-length(p - vec2(-.6, .2)) * 2.);
  return color;
}
vec3 veil(vec2 uv, float t) {
  vec2 q = uv * vec2(resolution.x / resolution.y, 1.);
  vec2 flow = vec2(fbm(q * 1.8 + vec2(t * .21, -t * .28)),
    fbm(q * 1.6 + vec2(-t * .19, t * .23) + 7.));
  float field = q.y * .9 + sin(q.x * 2.1 + t * .43) * .22
    + fbm(q * 2.1 + flow * 2.6 + vec2(t * .18, -t * .18)) * .55;
  float folds = max(0., sin(field * 12. - t * .36));
  float ribbon = pow(folds, 9.);
  float broad = folds * folds;
  float illumination = fbm(q * 1.4 + vec2(t * .22, 2.)) * 1.2;
  vec3 green = mix(vec3(.24, .43, .32), vec3(-.38, -.22, -.31), light);
  vec3 pearl = mix(vec3(.65, .69, .54), vec3(-.25, -.25, -.3), light);
  vec3 color = green * (broad * .35 + ribbon * .5) * illumination + pearl * ribbon * .22;
  vec2 center = (uv - vec2(.5, .43)) * vec2(2., 2.5);
  return color * (1. - .45 * exp(-dot(center, center)));
}

// uv has its origin at the bottom left. resolution is the canvas backing size.
// The repeated curves use their projected pixel spacing to soften dense folds.
float floraRibbonLines(float coordinate, float width) {
  const float count = 96.0;
  float pixel = count / max(resolution.y * width, 1.0);
  float distanceToLine = abs(fract(coordinate * count + 0.5) - 0.5);
  float line = 1.0 - smoothstep(pixel * 0.08, pixel * 0.85, distanceToLine);
  float average = min(pixel * 0.85, 1.0);
  return mix(line, average, smoothstep(0.55, 1.15, pixel));
}

vec3 ribbons(vec2 uv, vec2 p, float t, float light) {
  uv.y = 1.0 - uv.y;
  const float pi = 3.14159265;
  vec3 darkBase = vec3(0.0431, 0.0588, 0.0510);
  vec3 lightBase = vec3(0.9647, 0.9725, 0.9608);
  vec3 color = mix(darkBase, lightBase, light);
  float glow = exp(-length((uv - vec2(0.14, 0.12)) * vec2(1.5, 1.0)) * 3.0);
  color += mix(vec3(0.016, 0.035, 0.020), vec3(-0.012, -0.004, -0.012), light) * glow;

  float u = (uv.x + 0.15) / 1.3;
  float arch = sin(u * pi);
  float width = 0.09 + 0.45 * arch * arch;
  float center = 0.16 + sin(u * 5.3 + t * 0.28) * 0.17 + sin(u * 9.0 - t * 0.2) * 0.035;
  float q = (uv.y - center) / width + 0.5;
  // Invert the gentle cross-ribbon bend to retain evenly engraved curves.
  for (int i = 0; i < 3; i++) {
    float bend = sin(u * 7.0 + q * 2.5 + t * 0.32) * 0.065 * arch;
    q = (uv.y - center - bend) / width + 0.5;
  }
  float envelope = pow(max(sin(clamp(q, 0.0, 1.0) * pi), 0.0), 0.7);
  float shimmer = 0.65 + 0.35 * sin(q * 12.0 + t * 0.5);
  vec3 sage = mix(vec3(0.584, 0.714, 0.608), vec3(0.278, 0.455, 0.357), smoothstep(0.0, 0.45, uv.x));
  sage = mix(sage, vec3(0.761, 0.812, 0.690), smoothstep(0.45, 1.0, uv.x));
  sage = mix(sage, vec3(0.23, 0.39, 0.29), light);
  float strength = mix(0.7, 0.3, smoothstep(0.0, 0.45, uv.x));
  strength = mix(strength, 0.65 * shimmer, smoothstep(0.45, 1.0, uv.x));
  float ink = floraRibbonLines(q, width) * envelope * strength;
  color = mix(color, sage, ink * mix(1.0, 0.55, light));

  width = 0.04 + 0.24 * arch;
  center = 0.79 + sin(u * 5.2 - t * 0.23 + 1.2) * 0.15;
  q = (uv.y - center) / width + 0.5;
  for (int i = 0; i < 3; i++) {
    float bend = sin(u * 10.0 + q * 2.0 + t * 0.17) * 0.038 * arch;
    q = (uv.y - center - bend) / width + 0.5;
  }
  envelope = pow(max(sin(clamp(q, 0.0, 1.0) * pi), 0.0), 0.7);
  vec3 warm = mix(vec3(0.459, 0.592, 0.494), vec3(0.588, 0.608, 0.494), smoothstep(0.0, 0.6, uv.x));
  warm = mix(warm, vec3(0.878, 0.706, 0.592), smoothstep(0.6, 1.0, uv.x));
  warm = mix(warm, vec3(0.50, 0.34, 0.25), light);
  strength = mix(0.24, 0.3, smoothstep(0.0, 0.6, uv.x));
  strength = mix(strength, 0.55, smoothstep(0.6, 1.0, uv.x));
  ink = floraRibbonLines(q, width) * envelope * strength;
  return mix(color, warm, ink * mix(1.0, 0.45, light));
}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution;
  vec2 p = (uv - .5) * vec2(resolution.x / resolution.y, 1.);
  float t = time * .22 + (seed - 1.) * 2.4;
  vec3 base = mix(vec3(.025, .040, .034), vec3(.965, .974, .96), light);
  vec3 color;
  if (variant == 2) {
    color = ribbons(uv, p, time * .85 + (seed - 1.) * 2.4, light);
  } else {
    vec3 field = variant == 1 ? veil(uv, t) : silk(p, t);
    float vignette = 1. - .32 * smoothstep(.1, 1., length(p));
    color = base + field * vignette;
  }
  color += (hash(gl_FragCoord.xy) - .5) * mix(.032, .023, light);
  gl_FragColor = vec4(color, 1.);
}
`;
