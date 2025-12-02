// server.js - Lee Downloader Web 백엔드 (Fastify + yt-dlp)

const fastify = require("fastify")({ logger: true });
const cors = require("@fastify/cors");
const multipart = require("@fastify/multipart"); // 필요 없더라도 유지해도 무방
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

// CORS: 어디서든 호출 가능하게 (GitHub Pages 포함)
fastify.register(cors, {
  origin: true,
});

// (여기서는 JSON만 쓰지만, 나중 확장용으로 남겨둠)
fastify.register(multipart);

// 헬스 체크용 루트
fastify.get("/", async () => {
  return { ok: true, service: "lee-downloader-server" };
});

/**
 * /api/download
 * body: { url, mode: "video" | "audio", quality: "best" | "720p" | ... }
 */
fastify.post("/api/download", async (request, reply) => {
  const { url, mode = "video", quality = "best" } = request.body || {};

  if (!url || typeof url !== "string") {
    reply.code(400).send({
      success: false,
      message: "URL이 비어 있습니다.",
    });
    return;
  }

  // 임시 파일 경로 생성
  const id = Date.now() + "-" + Math.random().toString(36).slice(2);
  const isAudio = mode === "audio";
  const ext = isAudio ? "mp3" : "mp4";
  const outFile = path.join(os.tmpdir(), `lee_dl_${id}.${ext}`);

  // yt-dlp 인자 구성
  const args = [url];

  // 공통 옵션 (조용하게, 재시도 몇 번)
  args.push(
    "--no-playlist",
    "--no-warnings",
    "--ignore-errors",
    "--retries",
    "3"
  );

  if (isAudio) {
    // 오디오 전용 (mp3 최고 음질)
    args.push(
      "-x",
      "--audio-format",
      "mp3",
      "--audio-quality",
      "0",
      "-o",
      outFile
    );
  } else {
    // 비디오 모드
    let format = "bv*+ba/best";

    const map = {
      "2160p": "2160",
      "1440p": "1440",
      "1080p": "1080",
      "720p": "720",
      "480p": "480",
      "360p": "360",
    };

    if (quality && quality !== "best" && map[quality]) {
      const h = map[quality];
      format = `bestvideo[height<=${h}]+bestaudio/best`;
    }

    args.push("-f", format, "-o", outFile);
  }

  fastify.log.info({ args }, "yt-dlp 호출 인자");

  return new Promise((resolve) => {
    let stderr = "";

    const ytdlp = spawn("yt-dlp", args);

    ytdlp.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      fastify.log.warn({ text }, "yt-dlp stderr");
    });

    ytdlp.on("close", (code) => {
      fastify.log.info({ code }, "yt-dlp 종료 코드");

      // 실패: 파일도 안 만들었거나, 사이즈 0이거나, exit code != 0
      if (
        code !== 0 ||
        !fs.existsSync(outFile) ||
        fs.statSync(outFile).size === 0
      ) {
        const shortErr = stderr.slice(-500); // 너무 길면 뒤 500자만
        fastify.log.error(
          { code, shortErr },
          "다운로드 실패 - 클라이언트에 에러 전달"
        );

        if (!reply.sent) {
          reply.code(500).send({
            success: false,
            message: "다운로드 중 오류가 발생했습니다.",
            detail: shortErr,
          });
        }
        return resolve();
      }

      // 성공: 파일을 읽어서 스트림으로 전송
      reply.header(
        "Content-Type",
        isAudio ? "audio/mpeg" : "video/mp4"
      );
      reply.header(
        "Content-Disposition",
        `attachment; filename="lee_downloader_${isAudio ? "audio" : "video"}_${id}.${ext}"`
      );

      const stream = fs.createReadStream(outFile);

      stream.on("error", (err) => {
        fastify.log.error({ err }, "임시 파일 읽기 오류");
        if (!reply.sent) {
          reply
            .code(500)
            .send({ success: false, message: "파일 읽기 중 오류가 발생했습니다." });
        }
        return resolve();
      });

      stream.on("close", () => {
        // 임시 파일 삭제
        fs.unlink(outFile, () => {});
        resolve();
      });

      // 스트림을 그대로 응답으로 파이프
      stream.pipe(reply.raw);
    });
  });
});

// 서버 시작
const PORT = process.env.PORT || 3000;
fastify
  .listen({ port: PORT, host: "0.0.0.0" })
  .then(() => {
    fastify.log.info(`Server listening on port ${PORT}`);
  })
  .catch((err) => {
    fastify.log.error(err);
    process.exit(1);
  });
