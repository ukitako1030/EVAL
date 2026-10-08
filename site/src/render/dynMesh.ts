/**
 * A PixiJS mesh whose triangles are rewritten in place (./meshBuild): per-vertex colours, persistent typed-array
 * buffers, one draw call, no garbage. Replaces `Graphics.clear()` + redraw for geometry that changes every frame —
 * a redrawn `Graphics` is re-tessellated into fresh arrays and, being batchable, forces PixiJS to rebuild the whole
 * scene's instruction list; a buffer update does neither.
 *
 * The shader is the batcher's colour maths without a texture: straight-alpha vertex colour, premultiplied, times the
 * mesh's tint / alpha (incl. its parents') and the render group colour, so `alpha`, `tint`, `blendMode` and container
 * fades behave as on a `Graphics`. WebGL only (the app's renderer; PixiJS prefers WebGL).
 */
import { Buffer, BufferUsage, Geometry, GlProgram, Mesh, Shader } from 'pixi.js';
import { createMeshBuf, resetMeshBuf, scaleAlpha, type MeshBuf } from './meshBuild';

const VERTEX = `
attribute vec2 aPosition;
attribute vec4 aColor;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform vec4 uWorldColorAlpha;
uniform mat3 uTransformMatrix;
uniform vec4 uColor;

varying vec4 vColor;

void main(void) {
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    vColor = vec4(aColor.rgb * aColor.a, aColor.a) * uColor * uWorldColorAlpha;
}
`;

const FRAGMENT = `
varying vec4 vColor;

void main(void) {
    gl_FragColor = vColor;
}
`;

let sharedShader: Shader | null = null;
function shader(): Shader {
  return (sharedShader ??= new Shader({ glProgram: GlProgram.from({ vertex: VERTEX, fragment: FRAGMENT, name: 'aiwar-dyn-mesh' }), resources: {} }));
}

export interface DynMesh {
  readonly mesh: Mesh<Geometry, Shader>;
  /** write geometry here between `begin()` and `end()` */
  readonly buf: MeshBuf;
  /** start a new set of triangles */
  begin(): void;
  /** upload what was written since `begin()` */
  end(): void;
  /**
   * Snapshot the colours just written (after `end()`) as the base for `setAlpha`: per-frame fades of parts of the mesh
   * (a flickering frontline, a territory's brightness) then only rewrite and re-upload the colour buffer.
   */
  keepColors(): void;
  /** vertices [v0, v1): base colour with its alpha × k (call `flushColors()` once done) */
  setAlpha(v0: number, v1: number, k: number): void;
  flushColors(): void;
  destroy(): void;
}

export function createDynMesh(opts: { label?: string; blendMode?: 'normal' | 'add'; verts?: number; indices?: number } = {}): DynMesh {
  const buf = createMeshBuf(opts.verts ?? 256, opts.indices ?? 768);
  const usage = BufferUsage.VERTEX | BufferUsage.COPY_DST;
  const posBuf = new Buffer({ data: buf.pos, usage, shrinkToFit: false, label: 'dyn-pos' });
  const colBuf = new Buffer({ data: buf.col, usage, shrinkToFit: false, label: 'dyn-col' });
  const idxBuf = new Buffer({ data: buf.idx, usage: BufferUsage.INDEX | BufferUsage.COPY_DST, shrinkToFit: false, label: 'dyn-idx' });
  const geometry = new Geometry({
    attributes: {
      aPosition: { buffer: posBuf, format: 'float32x2', stride: 8, offset: 0 },
      aColor: { buffer: colBuf, format: 'unorm8x4', stride: 4, offset: 0 },
    },
    indexBuffer: idxBuf,
    topology: 'triangle-list',
  });
  const mesh = new Mesh({ geometry, shader: shader(), label: opts.label ?? 'dyn-mesh' });
  mesh.eventMode = 'none';
  if (opts.blendMode) mesh.blendMode = opts.blendMode;
  let base = new Uint32Array(0);
  let colDirty = false;
  /** showing nothing (a degenerate triangle) — a new empty frame needs no upload */
  let empty = true;
  // a never-filled mesh draws one degenerate triangle of the zeroed index buffer
  geometry.indexCount = 3;

  function sync() {
    if (!buf.grew) return;
    buf.grew = false;
    if (posBuf.data !== buf.pos) posBuf.data = buf.pos;
    if (colBuf.data !== buf.col) colBuf.data = buf.col;
    if (idxBuf.data !== buf.idx) idxBuf.data = buf.idx;
  }

  return {
    mesh,
    buf,
    begin() {
      resetMeshBuf(buf);
    },
    end() {
      sync();
      if (buf.ni === 0) {
        if (empty) return;
        // indexCount 0 would mean "the whole buffer": draw one degenerate triangle instead
        empty = true;
        buf.idx[0] = buf.idx[1] = buf.idx[2] = 0;
        geometry.indexCount = 3;
        idxBuf.update(12);
        return;
      }
      empty = false;
      geometry.indexCount = buf.ni;
      posBuf.update(buf.nv * 8);
      colBuf.update(buf.nv * 4);
      idxBuf.update(buf.ni * 4);
      colDirty = false;
    },
    keepColors() {
      if (base.length < buf.col.length) base = new Uint32Array(buf.col.length);
      base.set(buf.col.subarray(0, buf.nv));
    },
    setAlpha(v0, v1, k) {
      const col = buf.col;
      const end = Math.min(v1, buf.nv);
      for (let v = v0; v < end; v++) col[v] = scaleAlpha(base[v], k);
      colDirty = true;
    },
    flushColors() {
      if (!colDirty || buf.nv === 0) return;
      colDirty = false;
      colBuf.update(buf.nv * 4);
    },
    destroy() {
      mesh.destroy();
      geometry.destroy(true);
    },
  };
}
