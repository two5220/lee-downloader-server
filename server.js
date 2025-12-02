// server.js  (CommonJS 버전)

const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const fastify = require("fastify")({ logger: true });
const cors = require("@fastify/cors");

// ========= 기본 설정 =========
const PORT = process.env.PORT || 10000;

// CORS: GitHub Pages 와 프론트에서 호출 가능하도록 전체 허용
fastify.register(cors, {
  origin: true,          // '*' 대신 true: Origin 그대로 반사
  methods: ["GET", "POST", "OPTIONS"],
});

// 헬스체크
fastify.get("/", async () => {
  return { ok: true, service: "Lee Downloader API" };
});

// ========= /api/download =========
// body: { url, mode, quality }
//   mode: "video" | "audio"
//   quality: "auto" | "2160p" | "1440p" | ...
fastify.post("/api/download", async (request, reply) => {
  const { url, mode = "video", quality = "auto" } = request.body || {};

  if (!url || typeof url !== "string") {
    reply.code(400);
    return { success: false, message: "URL이 비어 있습니다." };
  }

  // 임시 파일 경로 만들기 (/tmp 는 리눅스 컨테이너에서 사용 가능)
  const id = Date.now() + "-" + Math.random().toString(16).slice(2);
  let ext = mode === "audio" ? "mp3" : "mp4";
  const tmpPath = path.join("/tmp", `lee_downloader_${id}.${ext}`);

  // yt-dlp 인자 만들기
  const args = [];

  // 출력 파일
  args.push("-o", tmpPath);

  // 재생목록 통째로 말고 단일만
  args.push("--no-playlist");

  // 모드에 따라 포맷 설정
  if (mode === "audio") {
    // 최고 음질 오디오 → mp3 변환
    args.push(
      "-f",
      "bestaudio/best",
      "--extract-audio",
      "--audio-format",
      "mp3",
      "--audio-quality",
      "0"
    );
  } else {
    // 영상 모드
    // 기본 포맷: best video + best audio
    let format = "bv*+ba/best";

    // 해상도 제한 (quality 값은 "1080p" 이런 식)
    const map = {
      "2160p": 2160,
      "1440p": 1440,
      "1080p": 1080,
      "720p": 720,
      "480p": 480,
      "360p": 360,
    };

    if (quality && quality !== "auto" && map[quality]) {
      const h = map[quality];
      format = `bestvideo[height<=${h}]+bestaudio/best`;
    }

    args.push("-f", format);
  }

  // URL 마지막에 추가
  args.push(url);

  fastify.log.info({ url, mode, quality, tmpPath }, "Start yt-dlp");

  return new Promise((resolve) => {
    let stderr = "";

    const ytdlp = spawn("yt-dlp", args);

    ytdlp.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      console.log("yt-dlp:", text.trim());
    });

    ytdlp.on("error", (err) => {
      fastify.log.error({ err }, "yt-dlp spawn error");
      if (fs.existsSync(tmpPath)) {
        fs.unlink(tmpPath, () => {});
      }
      reply.code(500);
      resolve({
        success: false,
        message: "서버에서 yt-dlp 실행 중 오류가 발생했습니다.",
      });
    });

    ytdlp.on("close", (code) => {
      fastify.log.info({ code }, "yt-dlp exit");

      // 실패 처리
      if (code !== 0 || !fs.existsSync(tmpPath)) {
        let msg = "다운로드 중 오류가 발생했습니다.";

        // 유튜브 “로그인/봇 확인” 에러 감지
        if (stderr.includes("Sign in to confirm you're not a bot")) {
          msg =
            "이 영상은 유튜브 로그인이 필요해서 웹 버전에서는 다운로드할 수 없습니다.\n" +
            "PC용 Lee Downloader 프로그램에서 시도해 주세요.";
        } else if (stderr.toLowerCase().includes("copyright")) {
          msg =
            "저작권 제한으로 인해 이 영상은 다운로드할 수 없습니다.";
        }

        fastify.log.error({ stderr }, "yt-dlp failed");

        if (fs.existsSync(tmpPath)) {
          fs.unlink(tmpPath, () => {});
        }

        reply.code(500);
        return resolve({ success: false, message: msg });
      }

      // 성공: 파일 사이즈 확인
      const stat = fs.statSync(tmpPath);
      if (stat.size === 0) {
        fs.unlink(tmpPath, () => {});
        reply.code(500);
        return resolve({
          success: false,
          message: "결과 파일이 비어 있습니다.",
        });
      }

      // 여기서부터 파일 스트리밍 응답
      const filenameBase = "lee_downloader";
      const filename = `${filenameBase}_${mode === "audio" ? "audio" : "video"}.${ext}`;

      reply.header(
        "Content-Type",
        mode === "audio" ? "audio/mpeg" : "video/mp4"
      );
      reply.header(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(filename)}"`
      );

      const stream = fs.createReadStream(tmpPath);

      // 스트림이 끝나면 임시파일 삭제
      stream.on("close", () => {
        fs.unlink(tmpPath, () => {});
      });

      stream.pipe(reply.raw);

      // fastify에서 직접 resolve 안 하면 응답이 끝날 때까지 기다림
      resolve();
    });
  });
});

// 서버 시작
const start = async () => {
  try {
    await fastify.listen({ port: PORT, host: "0.0.0.0" });
    console.log("==> Lee Downloader API listening on", PORT);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
