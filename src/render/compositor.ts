import type { Adjust, LutPreset } from '../types';

export interface DrawLayer {
  key: string;
  source: TexImageSource;
  srcW: number;
  srcH: number;
  /** Re-upload every frame (video) or only when `version` changes (images, text). */
  dynamic: boolean;
  version: string;
  /** 'contain' fits the source inside the canvas; 'native' sizes it relative to a 1080-px-tall reference. */
  fit: 'contain' | 'native';
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  lut: LutPreset | null;
  intensity: number;
  adjust: Adjust | null;
}

export interface LayerGeometry {
  key: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
  rotation: number;
}

const VS = `#version 300 es
in vec2 aCorner;
uniform vec2 uCanvas;
uniform vec2 uCenter;
uniform vec2 uSize;
uniform float uRot;
out vec2 vUv;
void main() {
  vec2 p = aCorner * uSize;
  float c = cos(uRot), s = sin(uRot);
  p = vec2(p.x * c - p.y * s, p.x * s + p.y * c) + uCenter;
  gl_Position = vec4(p.x / uCanvas.x * 2.0 - 1.0, 1.0 - p.y / uCanvas.y * 2.0, 0.0, 1.0);
  vUv = aCorner + 0.5;
}`;

const FS = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform sampler3D uLut;
uniform float uLutSize;
uniform float uLutMix;
uniform float uOpacity;
uniform vec4 uAdjust;
void main() {
  vec4 c = texture(uTex, vUv);
  vec3 rgb = c.rgb;
  if (uLutMix > 0.0) {
    vec3 coord = clamp(rgb, 0.0, 1.0) * ((uLutSize - 1.0) / uLutSize) + 0.5 / uLutSize;
    rgb = mix(rgb, texture(uLut, coord).rgb, uLutMix);
  }
  rgb += uAdjust.x;
  rgb = (rgb - 0.5) * uAdjust.y + 0.5;
  float l = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  rgb = mix(vec3(l), rgb, uAdjust.z);
  rgb += vec3(uAdjust.w, uAdjust.w * 0.2, -uAdjust.w);
  rgb = clamp(rgb, 0.0, 1.0);
  float a = c.a * uOpacity;
  outColor = vec4(rgb * a, a);
}`;

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [0, 0, 0];
}

export class Compositor {
  readonly gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private textures = new Map<string, { tex: WebGLTexture; version: string; used: number }>();
  private luts = new Map<string, WebGLTexture>();
  private dummyLut: WebGLTexture;
  private frame = 0;
  geometry: LayerGeometry[] = [];

  constructor(readonly canvas: HTMLCanvasElement | OffscreenCanvas, preserve = false) {
    const gl = canvas.getContext('webgl2', {
      premultipliedAlpha: true,
      alpha: false,
      antialias: true,
      preserveDrawingBuffer: preserve,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link error');
    this.prog = prog;
    for (const name of ['uCanvas', 'uCenter', 'uSize', 'uRot', 'uTex', 'uLut', 'uLutSize', 'uLutMix', 'uOpacity', 'uAdjust'])
      this.u[name] = gl.getUniformLocation(prog, name);

    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aCorner');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.dummyLut = this.createLut(2, new Uint8Array(2 * 2 * 2 * 4).fill(255));
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  private createLut(size: number, data: Uint8Array) {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, size, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return tex;
  }

  private lutTexture(lut: LutPreset) {
    let tex = this.luts.get(lut.id);
    if (!tex) {
      tex = this.createLut(lut.size, lut.data);
      this.luts.set(lut.id, tex);
    }
    return tex;
  }

  private layerTexture(layer: DrawLayer): WebGLTexture | null {
    const gl = this.gl;
    let entry = this.textures.get(layer.key);
    const needsUpload = !entry || layer.dynamic || entry.version !== layer.version;
    if (!entry) {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      entry = { tex, version: '', used: 0 };
      this.textures.set(layer.key, entry);
    }
    gl.bindTexture(gl.TEXTURE_2D, entry.tex);
    if (needsUpload) {
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, layer.source);
        entry.version = layer.version;
      } catch {
        if (!entry.version) return null;
      }
    }
    entry.used = this.frame;
    return entry.tex;
  }

  resize(width: number, height: number) {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  render(layers: DrawLayer[], background: string) {
    const gl = this.gl;
    const W = this.canvas.width;
    const H = this.canvas.height;
    this.frame++;
    gl.viewport(0, 0, W, H);
    const [r, g, b] = hexToRgb(background);
    gl.clearColor(r, g, b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform2f(this.u.uCanvas, W, H);
    gl.uniform1i(this.u.uTex, 0);
    gl.uniform1i(this.u.uLut, 1);
    this.geometry = [];

    for (const layer of layers) {
      if (layer.opacity <= 0 || !layer.srcW || !layer.srcH) continue;
      gl.activeTexture(gl.TEXTURE0);
      const tex = this.layerTexture(layer);
      if (!tex) continue;
      const base = layer.fit === 'contain' ? Math.min(W / layer.srcW, H / layer.srcH) : H / 1080;
      const w = layer.srcW * base * layer.scale;
      const h = layer.srcH * base * layer.scale;
      const cx = W * (0.5 + layer.x);
      const cy = H * (0.5 + layer.y);
      const rot = (layer.rotation * Math.PI) / 180;
      this.geometry.push({ key: layer.key, cx: cx / W, cy: cy / H, w: w / W, h: h / H, rotation: rot });

      gl.activeTexture(gl.TEXTURE1);
      const lutMix = layer.lut ? layer.intensity : 0;
      gl.bindTexture(gl.TEXTURE_3D, layer.lut ? this.lutTexture(layer.lut) : this.dummyLut);
      gl.uniform1f(this.u.uLutSize, layer.lut?.size ?? 2);
      gl.uniform1f(this.u.uLutMix, lutMix);
      const a = layer.adjust;
      gl.uniform4f(
        this.u.uAdjust,
        a ? a.brightness / 250 : 0,
        a ? 1 + a.contrast / 100 : 1,
        a ? 1 + a.saturation / 100 : 1,
        a ? a.temperature / 500 : 0,
      );
      gl.uniform1f(this.u.uOpacity, layer.opacity);
      gl.uniform2f(this.u.uCenter, cx, cy);
      gl.uniform2f(this.u.uSize, w, h);
      gl.uniform1f(this.u.uRot, rot);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    for (const [key, entry] of this.textures) {
      if (this.frame - entry.used > 300) {
        gl.deleteTexture(entry.tex);
        this.textures.delete(key);
      }
    }
  }

  /** Returns the topmost layer key under a point given in 0..1 canvas coordinates. */
  hitTest(nx: number, ny: number): string | null {
    const W = this.canvas.width;
    const H = this.canvas.height;
    for (let i = this.geometry.length - 1; i >= 0; i--) {
      const g = this.geometry[i];
      const dx = (nx - g.cx) * W;
      const dy = (ny - g.cy) * H;
      const c = Math.cos(-g.rotation), s = Math.sin(-g.rotation);
      const lx = dx * c - dy * s;
      const ly = dx * s + dy * c;
      if (Math.abs(lx) <= (g.w * W) / 2 && Math.abs(ly) <= (g.h * H) / 2) return g.key;
    }
    return null;
  }

  dispose() {
    const gl = this.gl;
    for (const e of this.textures.values()) gl.deleteTexture(e.tex);
    for (const t of this.luts.values()) gl.deleteTexture(t);
    this.textures.clear();
    this.luts.clear();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
