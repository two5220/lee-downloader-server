// server.js - Lee Downloader Web API
// Fastify + yt-dlp 스트리밍 + 로그인 필요 영상 사전 체크

const fastify = require("fastify")({ logger: true });
const cors = require("@fastify/cors");
const { spawn } = require("child_process");

const PORT = process.env.PORT || 3000;

// CORS 허용 (웹앱에서 Ajax 요청 허용)
fastify.register(cors, {
  origin: true,
  methods: ["GET", "POST", "OPTIONS"],
});

// 헬스 체크용 루트
fastify.get("/", async () => {
  return { ok: true, name: "Lee Downloader API", version: "1.0.0" };
});

// yt-dlp를 한 번 실행해서 결과(status, stderr, stdout)를 받아오는 헬퍼
function runYtDlp(args) {
  return new Promise((resolve) => {
    const proc = spawn("yt-dlp", args);
    let stderr = "";
    let stdout = "";

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      fastify.log.warn({ msg: "yt-dlp stderr", text });
    });

    proc.on("error", (err) => {
      fastify.log.error(err);
      resolve({ code: -1, stderr: String(err), stdout });
    });

    proc.on("close", (code) => {
      resolve({ code, stderr, stdout });
    });
  });
}

// 메인 다운로드 엔드포인트
fastify.post("/api/download", async (request, reply) => {
  const body = request.body || {};
  const url = (body.url || "").trim();
  const downloadType = body.downloadType === "audio" ? "audio" : "video"; // 'video' | 'audio'
  const quality = body.quality || "auto"; // 'auto' or '2160' '1080' ...

  if (!url) {
    reply.code(400);
    return { success: false, message: "URL이 비어 있습니다." };
  }

  // 1단계: 사전 체크 (simulate) - 로그인/봇 차단/DRM 등으로 막히는지 확인
  // 실패하면 아예 파일 스트림을 열지 않고 JSON 에러를 반환한다.
  const checkArgs = [
    "-s", // simulate: 다운로드는 안 하고 접근만 테스트
    "--no-warnings",
    "--quiet",
    url,
  ];

  const checkResult = await runYtDlp(checkArgs);

  if (checkResult.code !== 0) {
    const snippet = (checkResult.stderr || "").slice(0, 400);
    fastify.log.error({
      msg: "yt-dlp pre-check failed",
      code: checkResult.code,
      stderr: snippet,
    });

    reply.code(400);
    return {
      success: false,
      message:
        "이 영상은 유튜브에서 로그인 또는 추가 인증이 필요해서 웹 버전에서는 다운로드할 수 없어요.\nPC용 Lee Downloader(윈도우 프로그램)으로 시도해 주세요.",
      detail: snippet,
    };
  }

  // 2단계: 실제 다운로드 스트리밍
  const args = ["--no-progress", "--quiet", "--no-warnings"];

  if (downloadType === "audio") {
    // 최고 음질 mp3
    args.push("-f", "bestaudio/best");
    args.push("-x", "--audio-format", "mp3", "--audio-quality", "0");
  } else {
    // 영상
    if (quality === "auto") {
      args.push("-f", "bv*+ba/b");
    } else {
      const h = parseInt(quality, 10);
      if (!Number.isNaN(h)) {
        args.push("-f", `bestvideo[height<=${h}]+bestaudio/best`);
      } else {
        args.push("-f", "bv*+ba/b");
      }
    }
  }

  // 표준 출력으로 보내기
  args.push("-o", "-");
  args.push(url);

  const filenameBase =
    downloadType === "audio" ? "lee_downloader_audio" : "lee_downloader_video";
  const ext = downloadType === "audio" ? "mp3" : "mp4";

  reply.header(
    "Content-Type",
    downloadType === "audio" ? "audio/mpeg" : "video/mp4"
  );
  reply.header(
    "Content-Disposition",
    `attachment; filename="${filenameBase}.${ext}"`
  );

  // 스트리밍
  return await new Promise((resolve) => {
    const proc = spawn("yt-dlp", args);

    proc.stdout.on("data", (chunk) => {
      reply.raw.write(chunk);
    });

    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      fastify.log.warn({ msg: "yt-dlp stderr(download)", text });
    });

    proc.on("error", (err) => {
      fastify.log.error(err);
      // 이미 헤더가 나갔으면 바디만 종료
      if (!reply.raw.headersSent) {
        reply
          .code(500)
          .send({
            success: false,
            message: "다운로드 중 내부 오류가 발생했습니다.",
            detail: String(err),
          });
      } else {
        reply.raw.end();
      }
      resolve();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        fastify.log.info("yt-dlp download finished successfully");
        reply.raw.end();
      } else {
        fastify.log.error({
          msg: "yt-dlp download exit non-zero",
          code,
          stderr: stderr.slice(0, 400),
        });
        // 이 경우 브라우저에서는 손상된 파일로 보일 수 있지만,
        // 사전 체크에선 이미 통과했기 때문에 빈 파일은 거의 나오지 않는다.
        reply.raw.end();
      }
      resolve();
    });
  });
});

// 서버 시작
fastify.listen({ port: PORT, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  fastify.log.info(`Lee Downloader API listening on ${address}`);
});
