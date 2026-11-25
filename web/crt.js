// Bake one physical RGB stripe and one scanline period. The browser composites this
// tile over the live iframe, so the player never copies or reads a video frame.
const textures = new Map();
let gl, program;

function createProgram(context) {
  const vertex = `#version 300 es
    void main() {
      vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
      gl_Position = vec4(p, 0.0, 1.0);
    }`;
  const fragment = `#version 300 es
    precision highp float;
    uniform float pitch;
    out vec4 color;
    void main() {
      float phase = (gl_FragCoord.y - 0.5) / pitch;
      float gap = 0.5 - 0.5 * cos(6.2831853 * phase);
      float beam = 0.525 - 0.12 * gap * gap;
      vec3 stripe = vec3(-0.009);
      stripe[int(gl_FragCoord.x)] = 0.018;
      color = vec4(vec3(beam) + stripe, 1.0);
    }`;
  const result = context.createProgram();
  for (const [type, source] of [[context.VERTEX_SHADER, vertex], [context.FRAGMENT_SHADER, fragment]]) {
    const shader = context.createShader(type);
    context.shaderSource(shader, source);
    context.compileShader(shader);
    context.attachShader(result, shader);
    context.deleteShader(shader);
  }
  context.linkProgram(result);
  if (context.getProgramParameter(result, context.LINK_STATUS)) return result;
  context.deleteProgram(result);
  return null;
}

export function beamTexture(pitch) {
  if (textures.has(pitch)) return textures.get(pitch);
  if (gl === undefined) {
    gl = document.createElement("canvas").getContext("webgl2", {alpha: false, antialias: false, depth: false});
    if (gl) program = createProgram(gl);
  }
  if (!program || gl.isContextLost()) return null;
  gl.canvas.width = 3;
  gl.canvas.height = pitch;
  gl.viewport(0, 0, 3, pitch);
  gl.useProgram(program);
  gl.uniform1f(gl.getUniformLocation(program, "pitch"), pitch);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const url = gl.canvas.toDataURL();
  textures.set(pitch, url);
  return url;
}
