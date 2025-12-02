// server.js
import Fastify from "fastify";
import cors from "@fastify/cors";
import { spawn } from "child_process";

const fastify = Fastify({ logger: true });

async function build() {
  // CORS 허용 (프론트 도메인에서 호출 가능하게)
  await fastify.register(cors, {
    origin: "*",
  });

  // 단순 헬스체크용
  fastify.get("/", async () => {
    return { ok: true, service: "lee-downloader-server" };
  });

  // 실제 다운로드 엔드포인트
  fastify.post("/api/download", async (request, reply) => {
    const body = request.body || {};
    const url = (body.url || "").trim();
    const wantsAudioOnly = !!body.audioOnly;
    const resolution = body.resolution || "best";

    if (!url) {
      reply.code(400).send({
        success: false,
        message: "URL이 비어 있습니다.",
      });
      return;
    }

    // yt-dlp 옵션 만들기
    const args = ["-o", "-"]; // stdout 으로 내보내기

    if (wantsAudioOnly) {
      // 오디오만 (mp3)
      args.push(
        "-f",
        "ba/best",
        "-x",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "0" // 최고 음질
      );
    } else {
      // 영상 + 음성
      let heightFilter = "";
      if (resolution && resolution !== "best") {
        // 예: 1080p -> 1080
        const h = parseInt(String(resolution).replace(/\D/g, ""), 10);
        if (!isNaN(h)) {
          heightFilter = `[height<=${h}]`;
        }
      }
      const format = heightFilter
        ? `bestvideo${heightFilter}+bestaudio/best`
        : "bv*+ba/best";

      args.push("-f", format);
    }

    // 유튜브에서 "봇 의심" 같은 에러가 나면 stderr 로만 나오고
    // stdout 은 0바이트라서, 그 경우 JSON 에러를 돌려주도록 처리
    args.push(url);

    fastify.log.info({ url, args }, "Starting yt-dlp");

    const ytdlp = spawn("yt-dlp", args);

    let stderr = "";
    let startedStreaming = false;

    ytdlp.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      console.log("yt-dlp:", text);
    });

    ytdlp.stdout.on("data", (chunk) => {
      // 처음 데이터가 나오는 순간에만 헤더 세팅
      if (!startedStreaming) {
        startedStreaming = true;

        if (wantsAudioOnly) {
          reply.header("Content-Type", "audio/mpeg");
          reply.header(
            "Content-Disposition",
            'attachment; filename="lee_downloader.mp3"'
          );
        } else {
          reply.header("Content-Type", "video/mp4");
          reply.header(
            "Content-Disposition",
            'attachment; filename="lee_downloader.mp4"'
          );
        }
      }
      reply.raw.write(chunk);
    });

    ytdlp.on("close", (code) => {
      console.log("yt-dlp exit code:", code);

      // 한 번도 stdout 이 안 나왔다 = 파일을 한 바이트도 못 받음
      if (!startedStreaming) {
        const msg =
          stderr ||
          "다운로드 중 알 수 없는 오류가 발생했습니다. (stdout 비어 있음)";

        // 아직 아무 것도 안 보냈으니까 JSON 에러로 응답 가능
        if (!reply.sent) {
          reply.code(500).send({
            success: false,
            message:
              "다운로드에 실패했습니다. 유튜브에서 로그인 또는 봇 확인을 요구할 수 있습니다.",
            detail: msg,
          });
        }
      } else {
        // 스트림이 이미 시작된 경우는 그냥 닫기
        reply.raw.end();
      }
    });

    ytdlp.on("error", (err) => {
      console.error("yt-dlp spawn error:", err);
      if (!reply.sent) {
        reply.code(500).send({
          success: false,
          message: "서버에서 yt-dlp를 실행하지 못했습니다.",
          detail: String(err),
        });
      }
    });

    // Fastify에게 "우리가 스트림으로 직접 응답을 관리한다"는 의미
    return reply;
  });

  const port = process.env.PORT || 3000;
  const host = "0.0.0.0";

  fastify.listen({ port, host }, (err, address) => {
    if (err) {
      fastify.log.error(err);
      process.exit(1);
    }
    fastify.log.info(`Server listening at ${address}`);
  });
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
