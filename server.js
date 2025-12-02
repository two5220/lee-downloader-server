import Fastify from "fastify";
import cors from "@fastify/cors";
import { spawn } from "child_process";

const fastify = Fastify({ logger: true });
await fastify.register(cors, { origin: "*" });

fastify.post("/api/download", async (request, reply) => {
  const { url, resolution, mp3Only } = request.body || {};

  if (!url) {
    reply.code(400).send({ success: false, message: "URL이 비어 있어요." });
    return;
  }

  // yt-dlp 인자 구성 (mp3Only 여부에 따라 달리)
  const args = [
    "-o",
    "-",           // stdout 으로 출력
    url,
  ];

  if (mp3Only) {
    args.unshift(
      "-f", "ba/b",
      "--extract-audio",
      "--audio-format", "mp3",
      "--audio-quality", "0"
    );
  } else if (resolution && resolution !== "best") {
    args.unshift(
      "-f",
      `bestvideo[height<=${resolution}]+bestaudio/best`
    );
  } else {
    args.unshift("-f", "bv*+ba/b");
  }

  // yt-dlp 실행
  const ytdlp = spawn("yt-dlp", args);

  let stderr = "";
  const chunks = [];

  ytdlp.stderr.on("data", (data) => {
    const text = data.toString();
    stderr += text;
    console.log("yt-dlp:", text);
  });

  ytdlp.stdout.on("data", (data) => {
    chunks.push(data);
  });

  const exitCode = await new Promise((resolve) => {
    ytdlp.on("close", (code) => resolve(code));
  });

  if (exitCode !== 0 || chunks.length === 0) {
    // 에러 내용에 따라 좀 더 친절한 메시지
    let message = "다운로드 중 오류가 발생했습니다.";

    if (stderr.includes("Sign in to confirm you're not a bot")) {
      message =
        "이 영상은 유튜브 로그인이 필요해서 웹 버전에서는 다운로드할 수 없어요. PC용 Lee Downloader로 시도해 주세요.";
    } else if (stderr.includes("This video is available only to users")) {
      message = "로그인/연령 제한 영상이라 웹 버전에서는 지원이 어려워요.";
    }

    reply.code(400).send({
      success: false,
      message,
      rawError: stderr.slice(0, 500),
    });
    return;
  }

  // 여기까지 왔으면 정상 다운로드 성공 → 파일로 내려보내기
  const buffer = Buffer.concat(chunks);

  // 헤더 설정
  const filename = mp3Only ? "lee_downloader.mp3" : "lee_downloader.mp4";
  reply.header(
    "Content-Disposition",
    `attachment; filename="${filename}"`
  );

  reply.header(
    "Content-Type",
    mp3Only ? "audio/mpeg" : "video/mp4"
  );

  reply.send(buffer);
});

// 나머지 fastify.listen(...) 등은 그대로
