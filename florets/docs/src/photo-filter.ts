export type PhotoFilterSettings = {
  treatment: "source" | "stipple" | "mezzotint";
  size: number;
  strength: number;
  exposure: number;
  intensity: number;
  fade: number;
};

const fragmentSource = `
precision highp float;
uniform sampler2D photo;
uniform vec2 resolution;
uniform vec2 viewport;
uniform vec2 imageSize;
uniform float size;
uniform float strength;
uniform float exposure;
uniform float intensity;
uniform float fade;
uniform int treatment;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 samplePhoto(vec2 uv) {
  float imageAspect = imageSize.x / imageSize.y;
  float viewAspect = viewport.x / viewport.y;
  vec2 crop = vec2(min(1., viewAspect / imageAspect), min(1., imageAspect / viewAspect));
  vec3 color = texture2D(photo, (uv - .5) * crop + .5).rgb;
  float gray = dot(color, vec3(.2126, .7152, .0722));
  return clamp(mix(vec3(gray), color, .75) * exposure, 0., 1.);
}
void main() {
  vec2 uv = gl_FragCoord.xy / resolution;
  vec2 pixel = uv * viewport;
  vec3 color = samplePhoto(uv);
  vec3 filtered = color;
  float mark = 1.;
  if (treatment == 1) {
    vec2 cell = floor(pixel / size);
    mark = 0.;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 neighbor = cell + vec2(float(x), float(y));
        vec2 center = (neighbor + .05 + .9 * vec2(hash(neighbor), hash(neighbor + 37.))) * size;
        float radius = size * mix(.28, .35, hash(neighbor + 71.));
        float distanceToDot = length(pixel - center);
        float aa = viewport.y / resolution.y * .65;
        if (distanceToDot > radius + aa) continue;
        float dotMark = 1. - smoothstep(radius - aa, radius + aa, distanceToDot);
        mark = max(mark, dotMark);
      }
    }
    // Keep photographic detail between the marks, with less contrast at the tonal extremes.
    filtered = color + min(color, 1. - color) * (mark - .32) * 1.4;
  } else if (treatment == 2) {
    vec2 grain = floor(pixel / max(.6, size * .4));
    float threshold = hash(grain);
    // Stochastic rounding between nearby tone levels preserves the source's average color.
    vec3 levels = color * 7.;
    filtered = (floor(levels) + step(vec3(threshold), fract(levels))) / 7.;
  }
  color = mix(color, filtered, strength);
  float falloff = mix(1., smoothstep(.02, .85, uv.y), fade);
  vec3 ink = vec3(.043, .050, .046);
  gl_FragColor = vec4(mix(ink, color, intensity * falloff), 1.);
}
`;

/** Uploads a decoded image once; redraws only when the caller changes settings or size. */
export function createPhotoFilter(canvas: HTMLCanvasElement, image: HTMLImageElement) {
  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    depth: false,
    powerPreference: "low-power",
  });
  if (gl === null) return null;
  function compile(type: number, source: string) {
    if (gl === null) return null;
    const shader = gl.createShader(type);
    if (shader === null) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }
  const vertex = compile(
    gl.VERTEX_SHADER,
    "attribute vec2 position; void main(){gl_Position=vec4(position,0.,1.);}",
  );
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  if (vertex === null || fragment === null) {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    return null;
  }
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    gl.deleteProgram(program);
    return null;
  }
  const buffer = gl.createBuffer();
  const texture = gl.createTexture();
  const attribute = gl.getAttribLocation(program, "position");
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(attribute);
  gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  // Limit upload memory for camera-sized images before transferring them to the GPU.
  const upload = document.createElement("canvas");
  const scale = Math.min(
    1,
    2048 / Math.max(image.naturalWidth, image.naturalHeight),
    gl.getParameter(gl.MAX_TEXTURE_SIZE) / Math.max(image.naturalWidth, image.naturalHeight),
  );
  upload.width = Math.max(1, Math.round(image.naturalWidth * scale));
  upload.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = upload.getContext("2d");
  if (context !== null) context.drawImage(image, 0, 0, upload.width, upload.height);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, upload);
  const uniforms = Object.fromEntries(
    [
      "resolution",
      "viewport",
      "imageSize",
      "size",
      "strength",
      "exposure",
      "intensity",
      "fade",
      "treatment",
    ].map((name) => [name, gl.getUniformLocation(program, name)]),
  );
  return {
    draw(settings: PhotoFilterSettings) {
      if (gl.isContextLost()) return;
      const { width, height } = canvas.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      const ratio = Math.min(devicePixelRatio || 1, 2, Math.sqrt(2_000_000 / (width * height)));
      const w = Math.max(1, Math.round(width * ratio));
      const h = Math.max(1, Math.round(height * ratio));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uniforms.resolution ?? null, w, h);
      gl.uniform2f(uniforms.viewport ?? null, width, height);
      gl.uniform2f(uniforms.imageSize ?? null, image.naturalWidth, image.naturalHeight);
      for (const name of ["size", "strength", "exposure", "intensity", "fade"] as const) {
        gl.uniform1f(uniforms[name] ?? null, settings[name]);
      }
      gl.uniform1i(
        uniforms.treatment ?? null,
        { source: 0, stipple: 1, mezzotint: 2 }[settings.treatment],
      );
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.disableVertexAttribArray(attribute);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.useProgram(null);
      gl.deleteBuffer(buffer);
      gl.deleteTexture(texture);
      gl.deleteProgram(program);
    },
  };
}
