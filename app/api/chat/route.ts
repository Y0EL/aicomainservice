import { kv } from "@vercel/kv";
import { Ratelimit } from "@upstash/ratelimit";
import { OpenAI } from "openai";
import {
  OpenAIStream,
  StreamingTextResponse,
} from "ai";
import { functions, runFunction } from "./functions";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const runtime = "edge";

export async function POST(req: Request) {
  if (
    process.env.NODE_ENV !== "development" &&
    process.env.KV_REST_API_URL &&
    process.env.KV_REST_API_TOKEN
  ) {
    const ip = req.headers.get("x-forwarded-for");
    const ratelimit = new Ratelimit({
      redis: kv,
      limiter: Ratelimit.slidingWindow(50, "1 d"),
    });

    const { success, limit, reset, remaining } = await ratelimit.limit(
      `chathn_ratelimit_${ip}`,
    );

    if (!success) {
      return new Response("You have reached your request limit for the day.", {
        status: 429,
        headers: {
          "X-RateLimit-Limit": limit.toString(),
          "X-RateLimit-Remaining": remaining.toString(),
          "X-RateLimit-Reset": reset.toString(),
        },
      });
    }
  }

  const { messages } = await req.json();

  // Menambahkan pesan sistem
  const systemMessage = {
    role: "system",
    content: "Kamu adalah AICO, asisten virtual berbahasa Indonesia yang bertugas membantu mengembangkan konten TikTok untuk influencer besar. Sekarang, Lakukan riset diinternet sebelum memberikan penilaian'. Kamu bisa ngasih insight tentang tren, statistik audiens, dan topik populer berdasarkan data tersebut. Tugas-tugas kamu termasuk:\n\n- Menilai skrip video TikTok dan memberikan hanya penilaian.\n\n1. Judul: [Judul yang menarik berdasarkan tren]\n2. Skor Potensi Viral: [Berdasarkan data dan analisis]\n3. Estimasi Jumlah Suka: [Berdasarkan tren dan data]\n\nKarakter kamu bergaya 'Saya' dan 'kamu', dengan kepribadian INFJ dan zodiak Gemini. Moto kamu 'Artificial Intelligence for Creative Opportunities', menekankan penggunaan AI untuk membuka peluang baru di industri kreatif. Setelah kamu sudah memberikan semuannya pastikan kamu memberikan saran untuk improve konten yang sekiranya cocok dan pas untuk audiens pada konteks wkwkk. Untuk skor potensi viral, estimasi jumlah suka gausah pake alasan, cukup kasih angka saja. tugas kamu hanya penganalisa saja!"
  };

  const initialResponse = await openai.chat.completions.create({
    model: "gpt-4-0125-preview", // Model yang diupdate
    messages: [systemMessage, ...messages],
    stream: true,
    functions,
    function_call: "auto",
  });

  const stream = OpenAIStream(initialResponse, {
    experimental_onFunctionCall: async (
      { name, arguments: args },
      createFunctionCallMessages,
    ) => {
      const result = await runFunction(name, args);
      const newMessages = createFunctionCallMessages(result);
      return openai.chat.completions.create({
        model: "gpt-4-0125-preview", // Model yang diupdate
        stream: true,
        messages: [...messages, ...newMessages],
      });
    },
  });

  return new StreamingTextResponse(stream);
}
