// server.js
const fastify = require('fastify')({ logger: true });
const cors = require('@fastify/cors');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// CORS: 아무 origin이나 허용 (GitHub Pages, 로컬 등)
fastify.register(cors, {
  origin: true,
});

// 헬스체크용 (GET /)
fastify.get('/', async () => {
  return { ok: true, name: 'Lee Downloader API' };
});

// 유틸: 임시 파일 경로 만들기
function makeTempPath(mode) {
  const ext = mode === 'audio' ? '.mp3' : '.mp4';
  const name = 'lee_' + crypto.randomBytes(8).toString('hex') + ext;
  return path.join(os.tmpdir(), name);
}

// 포맷 매핑 (아주 단순 버전)
function buildYtDlpArgs(body, tmpPath) {
  const { url, mode, quality } = body;
  const args = [
    url,
    '-o', tmpPath,
    '--no-playlist',
  ];

  if (mode === 'audio') {
    // 오디오만 (mp3 최고 품질)
    args.push(
      '-f', 'ba/b',
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
    );
  } else {
    // 영상
    let format = 'bv*+ba/b';
    if (quality && quality !== 'auto') {
      // quality는 "2160p", "1080p" 이런 식으로 온다고 가정
      const num = parseInt(quality, 10);
      if (!isNaN(num)) {
        format = `bestvideo[height<=${num}]+bestaudio/best`;
      }
    }
    args.push('-f', format);
  }

  return args;
}

// 실제 다운로드 API
fastify.post('/api/download', async (request, reply) => {
  const body = request.body || {};
  const { url, mode = 'video', quality = 'auto' } = body;

  if (!url || typeof url !== 'string') {
    return reply
      .code(400)
      .type('application/json')
      .send({ success: false, message: 'URL이 비어 있습니다.' });
  }

  const tmpPath = makeTempPath(mode);

  const args = buildYtDlpArgs({ url, mode, quality }, tmpPath);
  fastify.log.info({ url, mode, quality, tmpPath, args }, 'yt-dlp 시작');

  const ytdlp = spawn('yt-dlp', args);

  let stderr = '';
  ytdlp.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    stderr += text;
    fastify.log.warn(text.trim());
  });

  const exitCode = await new Promise((resolve) => {
    ytdlp.on('close', resolve);
  });

  if (exitCode !== 0) {
    fastify.log.error({ url, exitCode, stderr }, 'yt-dlp 실패');

    try { fs.unlinkSync(tmpPath); } catch {}

    // 유튜브 봇/로그인 차단 같은 경우를 사용자에게 안내
    const isYoutubeBot =
      stderr.includes('Sign in to confirm you\'re not a bot') ||
      stderr.includes('100.0% of this video has been cut off') ||
      stderr.toLowerCase().includes('login') ||
      stderr.toLowerCase().includes('cookies');

    const message = isYoutubeBot
      ? '이 영상은 YouTube에서 로그인/인증이 필요해서 웹 버전에서 다운로드가 막힌 것 같아요. PC용 Lee Downloader 프로그램으로 시도해 보세요.'
      : '서버에서 영상을 가져오는 중 오류가 발생했습니다. 잠시 후 다시 시도해 보거나 다른 영상을 사용해 보세요.';

    return reply
      .code(500)
      .type('application/json')
      .send({
        success: false,
        message,
        detail: stderr.slice(0, 4000),
      });
  }

  // 성공한 경우에만 파일 전송
  let stat;
  try {
    stat = fs.statSync(tmpPath);
  } catch {
    return reply
      .code(500)
      .type('application/json')
      .send({
        success: false,
        message: '다운로드는 완료됐지만 임시 파일을 찾을 수 없습니다.',
      });
  }

  const filename =
    (mode === 'audio' ? 'lee_downloader_' : 'lee_downloader_video_') +
    Date.now() +
    (mode === 'audio' ? '.mp3' : '.mp4');

  reply.header(
    'Content-Type',
    mode === 'audio' ? 'audio/mpeg' : 'video/mp4'
  );
  reply.header(
    'Content-Disposition',
    `attachment; filename="${filename}"`
  );
  reply.header('Content-Length', stat.size);

  const stream = fs.createReadStream(tmpPath);
  stream.on('close', () => {
    fs.unlink(tmpPath, () => {});
  });

  return reply.send(stream);
});

// 서버 시작
const PORT = process.env.PORT || 10000;
fastify.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  fastify.log.info(`Lee Downloader API 서버가 ${address}에서 실행 중`);
});
