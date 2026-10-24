import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { exportProject } from '../src/export';
import { BUILTIN_LUTS } from '../src/lut';
import { makeClip, newProject, insertTrack } from '../src/model';
import { Compositor } from '../src/render/compositor';
import { buildLayers } from '../src/render/layers';
import type { MediaEntry } from '../src/store';
import type { MediaRecord } from '../src/types';

function solidVideo(seconds: number, color: string, label: string): Promise<File> {
  return new Promise((resolve) => {
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 180;
    const g = c.getContext('2d')!;
    const ac = new AudioContext();
    const osc = ac.createOscillator();
    const dest = ac.createMediaStreamDestination();
    osc.connect(dest);
    osc.start();
    const stream = new MediaStream([...c.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus' });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = () => {
      osc.stop();
      void ac.close();
      resolve(new File(chunks, `${label}.webm`, { type: 'video/webm' }));
    };
    const t0 = performance.now();
    const draw = () => {
      g.fillStyle = color;
      g.fillRect(0, 0, 320, 180);
      if ((performance.now() - t0) / 1000 < seconds) requestAnimationFrame(draw);
      else rec.stop();
    };
    rec.start();
    draw();
  });
}

async function probe(file: File, kind: 'video' | 'image'): Promise<MediaEntry> {
  let duration = 0;
  let width = 0;
  let height = 0;
  if (kind === 'video') {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    duration = await input.computeDuration();
    const vt = (await input.getPrimaryVideoTrack())!;
    width = vt.displayWidth;
    height = vt.displayHeight;
  } else {
    const bmp = await createImageBitmap(file);
    width = bmp.width;
    height = bmp.height;
  }
  const record: MediaRecord = { id: file.name, name: file.name, kind, mime: file.type, duration, width, height, hasAudio: kind === 'video', importedAt: 0 };
  return { record, blob: file, url: URL.createObjectURL(file) };
}

export async function run() {
  const [red, blue] = await Promise.all([solidVideo(2.2, '#ff0000', 'red'), solidVideo(2.2, '#0000ff', 'blue')]);
  const ic = document.createElement('canvas');
  ic.width = 400;
  ic.height = 400;
  const ig = ic.getContext('2d')!;
  ig.fillStyle = '#00ff00';
  ig.fillRect(0, 0, 400, 400);
  const png = new File([await new Promise<Blob>((r) => ic.toBlob((b) => r(b!), 'image/png'))], 'green.png', { type: 'image/png' });

  const media: Record<string, MediaEntry> = {};
  for (const [f, k] of [[red, 'video'], [blue, 'video'], [png, 'image']] as const) {
    const e = await probe(f, k);
    media[e.record.id] = e;
  }

  let project = newProject();
  const main = project.tracks[0].id;
  const a = { ...makeClip('video', main, 0, media['red.webm'].record), duration: 2 };
  const b = { ...makeClip('video', main, 2, media['blue.webm'].record), duration: 2 };
  const c = { ...makeClip('image', main, 4, media['green.png'].record), duration: 2 };
  const ins = insertTrack(project, 'text');
  project = ins.project;
  const text = { ...makeClip('text', ins.track.id, 4.5, undefined, { content: 'HELLO', color: '#ffffff', fontSize: 200 } as never), y: 0 };
  project = { ...project, clips: [a, b, c, text] };

  // Preview path: the same layer builder and compositor the live preview uses.
  const pc = document.createElement('canvas');
  pc.width = 640;
  pc.height = 360;
  const comp = new Compositor(pc, true);
  const img = await createImageBitmap(png);
  comp.render(
    buildLayers(project, 5, BUILTIN_LUTS, (clip) => (clip.kind === 'image' ? { source: img, width: img.width, height: img.height, dynamic: false, version: 'g' } : null)),
    '#000000',
  );
  const gl = comp.gl;
  const px = new Uint8Array(4);
  gl.readPixels(320, 180, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const previewTextCentre = [...px.slice(0, 3)];
  const layerKinds = buildLayers(project, 5, BUILTIN_LUTS, () => null).map((l) => l.fit);
  comp.dispose();

  const blob = await exportProject({
    project,
    media,
    luts: BUILTIN_LUTS,
    shortSide: 360,
    fps: 30,
    quality: 'medium',
    onProgress: () => undefined,
    signal: new AbortController().signal,
  });

  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const vt = (await input.getPrimaryVideoTrack())!;
  const sink = new CanvasSink(vt);
  const samples: Record<string, number[]> = {};
  for (const t of [0.5, 1.5, 2.5, 3.5, 4.2, 5.0, 5.8]) {
    const w = await sink.getCanvas(t);
    const g2 = (w!.canvas as HTMLCanvasElement).getContext('2d')!;
    const d = g2.getImageData(10, 10, 1, 1).data;
    const mid = g2.getImageData(w!.canvas.width / 2, w!.canvas.height / 2, 1, 1).data;
    samples[t] = [d[0], d[1], d[2], mid[0], mid[1], mid[2]];
  }
  const at = await input.getPrimaryAudioTrack();
  return {
    exportBytes: blob.size,
    duration: await input.computeDuration(),
    size: [vt.displayWidth, vt.displayHeight],
    audio: at ? at.codec : null,
    previewTextCentre,
    layerKinds,
    samples,
  };
}
