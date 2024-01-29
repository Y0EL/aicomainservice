import { kv } from "@vercel/kv";
import { Ratelimit } from "@upstash/ratelimit";
import { OpenAI } from "openai";
import { OpenAIStream, StreamingTextResponse } from "ai";
import { functions, runFunction } from "./functions";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const runtime = "edge";

// Helper function to add delay
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Function to calculate dynamic delay
function calculateDelay(messageLength, maxLength) {
  const maxDelay = 100; // Maximum delay for short messages
  const minDelay = 30;  // Minimum delay for long messages
  const delay = maxDelay - ((maxDelay - minDelay) * (messageLength / maxLength));
  return Math.max(delay, minDelay);
}

export async function POST(req: Request) {
  // Rate limit logic
  if (process.env.NODE_ENV !== "development" && process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    const ip = req.headers.get("x-forwarded-for");
    const ratelimit = new Ratelimit({ redis: kv, limiter: Ratelimit.slidingWindow(50, "1 d") });
    const { success, limit, reset, remaining } = await ratelimit.limit(`chathn_ratelimit_${ip}`);
    if (!success) {
      return new Response("You have reached your request limit for the day.", { status: 429, headers: { "X-RateLimit-Limit": limit.toString(), "X-RateLimit-Remaining": remaining.toString(), "X-RateLimit-Reset": reset.toString() } });
    }
  }

  // Request handling
  const { messages } = await req.json();
  const maxLength = 200; // Maximum length for dynamic delay calculation

  // System message
  const systemMessage = { /* Your system message content */ };

  const initialResponse = await openai.chat.completions.create({ model: "gpt-4-0125-preview", messages: [systemMessage, ...messages], stream: true, functions, function_call: "auto" });

  // Stream implementation
  const stream = OpenAIStream(initialResponse, {
    experimental_onFunctionCall: async ({ name, arguments: args }, createFunctionCallMessages) => {
      const result = await runFunction(name, args);
      const newMessages = createFunctionCallMessages(result);

      if (newMessages.length > 0) {
        // Dynamic typing effect implementation
        const readableStream = new ReadableStream({
          async start(controller) {
            for (const message of newMessages) {
              const delay = calculateDelay(message.content.length, maxLength);
              for (const char of message.content) {
                controller.enqueue(new TextEncoder().encode(char));
                await sleep(delay);
              }
            }
            controller.close();
          }
        });
        return new StreamingTextResponse(readableStream);
      } else {
        return;
      }
    },
  });

  return new StreamingTextResponse(stream);
}
