import Fastify from "fastify";
import cors from "@fastify/cors";
import { spawn } from "child_process";

const fastify = Fastify({ logger: true });
await fastify.register(cors, { origin: "*" });

fastify.post("/api/download", async (request, reply) => {
  try {
    const body = await request.body;
    const { url, resolution, mp3Only } = body;

    if (!url) {
      reply.code(400);
      return { error: "URL이 없습니다." };
    }

    reply.header(
      "Content-Disposition",
      `attachment; filename="lee_dl.${mp3Only ? "mp3" : "mp4"}"`
    );

    const ytdlpArgs = mp3Only
      ? ["-f", "bestaudio", "-x", "--audio-format", "mp3", url, "-o", "-"]
      : [
          "-f",
          resolution === "auto"
            ? "bestvideo+bestaudio"
            : `bestvideo[height<=${resolution}]+bestaudio`,
          url,
          "-o",
          "-"
        ];

    const proc = spawn("yt-dlp", ytdlpArgs);

    proc.stderr.on("data", (data) => {
      console.log("yt-dlp:", data.toString());
    });

    reply.type(mp3Only ? "audio/mpeg" : "video/mp4");

    return reply.send(proc.stdout);

  } catch (err) {
    console.error(err);
    reply.code(500);
    return { error: "서버 오류", details: err.toString() };
  }
});

const PORT = process.env.PORT || 3000;
fastify.listen({ port: PORT, host: "0.0.0.0" }, () => {
  console.log("Lee Downloader API Running on:", PORT);
});
