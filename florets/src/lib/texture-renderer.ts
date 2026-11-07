export type TextureRenderer = {
  draw: (seconds: number, options: { light: boolean; variant: number; seed: number }) => void;
  resize: () => void;
  dispose: () => void;
};

const vertexSource = `
attribute vec2 a;
void main() {
  gl_Position = vec4(a, 0.0, 1.0);
}
`;

/** Owns this canvas's WebGL resources. The caller schedules frames and handles context loss. */
export function createTextureRenderer(
  canvas: HTMLCanvasElement,
  fragmentSource: string,
): TextureRenderer | null {
  let context: WebGLRenderingContext | null;
  try {
    context = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
      preserveDrawingBuffer: false,
    });
  } catch {
    return null;
  }
  if (context === null || context.isContextLost()) return null;
  const gl = context;

  function compile(type: number, source: string) {
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

  const vertex = compile(gl.VERTEX_SHADER, vertexSource);
  if (vertex === null) return null;
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  if (fragment === null) {
    gl.deleteShader(vertex);
    return null;
  }
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.detachShader(program, vertex);
  gl.detachShader(program, fragment);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    gl.deleteProgram(program);
    return null;
  }

  const attribute = gl.getAttribLocation(program, "a");
  const buffer = gl.createBuffer();
  if (attribute < 0) {
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    return null;
  }
  const resolution = gl.getUniformLocation(program, "resolution");
  const time = gl.getUniformLocation(program, "time");
  const lightMode = gl.getUniformLocation(program, "light");
  const style = gl.getUniformLocation(program, "variant");
  const patternSeed = gl.getUniformLocation(program, "seed");
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(attribute);
  gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
  gl.disable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);
  let disposed = false;

  function resize() {
    if (disposed || gl.isContextLost()) return;
    const { width, height } = canvas.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    // Limit fragment work on large displays and avoid oversized buffers in narrow containers.
    const scale = Math.min(
      window.devicePixelRatio || 1,
      1.5,
      Math.sqrt(1_300_000 / (width * height)),
      4096 / width,
      4096 / height,
    );
    const pixelWidth = Math.max(1, Math.floor(width * scale));
    const pixelHeight = Math.max(1, Math.floor(height * scale));
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    gl.viewport(0, 0, pixelWidth, pixelHeight);
    gl.useProgram(program);
    gl.uniform2f(resolution, pixelWidth, pixelHeight);
  }

  resize();
  return {
    resize,
    draw(seconds, { light, variant, seed }) {
      if (disposed || gl.isContextLost()) return;
      gl.useProgram(program);
      gl.uniform1f(time, Number.isFinite(seconds) ? seconds : 0);
      gl.uniform1f(lightMode, light ? 1 : 0);
      gl.uniform1i(style, Number.isFinite(variant) ? Math.trunc(variant) : 0);
      gl.uniform1f(patternSeed, Number.isFinite(seed) ? seed : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      gl.disableVertexAttribArray(attribute);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.useProgram(null);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    },
  };
}
