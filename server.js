// server.js - Lee Downloader Web API (yt-dlp 백엔드)

import Fastify from "fastify";
import cors from "@fastify/cors";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const fastify = Fastify({ logger: true });

// CORS 허용 (프론트에서 바로 호출할 수 있게)
await fastify.register(cors, { origin: "*" });

// 유틸: yt-dlp stderr 모아서 문자열로
function collectStderr(proc, logPrefix = "yt-dlp") {
  let buf = "";
  proc.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    buf += text;
    console.log(`${logPrefix}:`, text.trim());
  });
  return () => buf;
}

// 메인 API
fastify.post("/api/download", async (request, reply) => {
  try {
    const body = request.body || {};
    const url = body.url;
    const resolution = body.resolution || "auto";
    const mp3Only = !!body.mp3Only;

    if (!url) {
      reply.code(400);
      return { ok: false, message: "URL이 없습니다." };
    }

    // 임시 파일 경로 (/tmp 아래에 랜덤 이름)
    const ext = mp3Only ? "mp3" : "mp4";
    const tmpName = `lee_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2)}.${ext}`;
    const outPath = path.join("/tmp", tmpName);

    // yt-dlp 옵션 구성
    let format;
    if (mp3Only) {
      format = "bestaudio/best";
    } else {
      if (resolution === "auto") {
        format = "bestvideo+bestaudio/best";
      } else {
        format = `bestvideo[height<=${resolution}]+bestaudio/best`;
      }
    }

    const args = mp3Only
      ? [
          "-f",
          format,
          "-x",
          "--audio-format",
          "mp3",
          "-o",
          outPath,
          url,
        ]
      : ["-f", format, "-o", outPath, url];

    fastify.log.info({ msg: "yt-dlp 실행", url, args });

    const proc = spawn("yt-dlp", args);
    const getStderr = collectStderr(proc);

    // 프로세스 종료 기다리기 (Promise 래핑)
    const exitCode = await new Promise((resolve) => {
      proc.on("close", (code) => resolve(code));
    });

    const stderr = getStderr();

    // 실패 시: JSON 에러로 응답
    if (exitCode !== 0) {
      fastify.log.error({ msg: "yt-dlp 실패", exitCode, stderr });

      // 로그인 필요/봇 의심 같은 메시지는 좀 더 친절하게 변환
      let userMessage = "다운로드 중 오류가 발생했습니다.";
      if (stderr.includes("Sign in to confirm you're not a bot")) {
        userMessage =
          "이 영상은 YouTube에서 사람 확인(로그인)이 필요해서 Web 버전에서는 다운로드할 수 없어요. PC용 Lee Downloader 프로그램으로 시도해 주세요.";
      }

      reply.code(500);
      return {
        ok: false,
        message: userMessage,
        stderr,
      };
    }

    // 성공 시: 파일이 실제로 존재하는지 확인
    let stat;
    try {
      stat = await fs.promises.stat(outPath);
    } catch (e) {
      fastify.log.error({ msg: "임시 파일 없음", outPath, e });
      reply.code(500);
      return {
        ok: false,
        message: "다운로드 파일을 찾을 수 없습니다.",
      };
    }

    // 파일 스트림으로 전송 + 전송 후 임시 파일 삭제
    reply.header(
      "Content-Disposition",
      `attachment; filename="lee_downloader.${ext}"`
    );
    reply.header("Content-Length", stat.size);
    reply.type(mp3Only ? "audio/mpeg" : "video/mp4");

    const stream = fs.createReadStream(outPath);
    stream.on("close", () => {
      fs.promises.unlink(outPath).catch(() => {});
    });

    return reply.send(stream);
  } catch (err) {
    fastify.log.error({ msg: "서버 예외", err });
    reply.code(500);
    return { ok: false, message: "서버 내부 오류", detail: err.toString() };
  }
});

// 포트 설정
const PORT = process.env.PORT || 3000;
fastify.listen({ port: PORT, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  fastify.log.info(`Lee Downloader API Running on ${address}`);
});
