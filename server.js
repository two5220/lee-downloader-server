import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { exec } from "child_process";
import { Readable } from "stream";

const fastify = Fastify({ logger: true });
fastify.register(cors, { origin: "*" });
fastify.register(multipart);

// health check
fastify.get("/", async () => {
  return { status: "ok", message: "Lee Downloader Backend Running" };
});

// 다운로드 API
fastify.post("/download", async (req, reply) => {
  try {
    const data = await req.file();

    if (!data) {
      reply.code(400).send({ error: "파일 데이터 없음" });
      return;
    }

    const json = JSON.parse(data.fields.data.value);
    const url = json.url;
    const format = json.format || "mp4";

    if (!url) {
      reply.code(400).send({ error: "URL 없음" });
      return;
    }

    const safeFileName = `lee_downloader_${Date.now()}.${format}`;
    const cmd = `yt-dlp -f bestaudio/best --no-playlist --max-filesize 500m -o - "${url}"`;

    const proc = exec(cmd);

    reply.header("Content-Disposition", `attachment; filename="${safeFileName}"`);
    reply.type("application/octet-stream");

    proc.stdout.pipe(reply.raw);

    proc.stderr.on("data", (chunk) => {
      console.log("yt-dlp stderr:", chunk.toString());
    });

    proc.on("close", () => {
      reply.raw.end();
    });

  } catch (err) {
    console.error(err);
    reply.code(500).send({ error: "다운로드 처리 중 오류 발생" });
  }
});

fastify.listen({ host: "0.0.0.0", port: process.env.PORT || 3000 }, () => {
  console.log("Lee Downloader API Running");
});
