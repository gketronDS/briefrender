// Reproducible example clip: a 20 s ffmpeg test pattern with a tone, stamped as an example.
// It is presentation-only sample media, not Briefrender output. Requires ffmpeg on PATH.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('./media/example.mp4', import.meta.url));
mkdirSync(fileURLToPath(new URL('./media/', import.meta.url)), { recursive: true });
execFileSync('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=20',
  '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=20',
  '-vf', "drawtext=text='EXAMPLE CLIP - not generated':fontsize=48:fontcolor=white:box=1:boxcolor=black@0.6:x=40:y=40",
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-af', 'volume=0.1',
  '-movflags', '+faststart', '-shortest', out,
], { stdio: 'inherit' });
console.log(`Wrote ${out}`);
