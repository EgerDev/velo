import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";
import { rateLimited, type RateState } from "@/lib/sign-in-link-policy";

const signupAttempts: RateState = new Map();
const SIGNUP_WINDOW_MS = 10 * 60 * 1000;
const SIGNUP_PER_IP = 8;

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => auth.handler(request),
      POST: async ({ request }) => {
        const path = new URL(request.url).pathname;
        if (path.includes("/sign-up/email")) {
          const { clientIp } = await import("@/lib/guest-limit.server");
          if (rateLimited(signupAttempts, `signup:${clientIp(request)}`, Date.now(), SIGNUP_PER_IP, SIGNUP_WINDOW_MS)) {
            return Response.json(
              { message: "Too many sign-ups from this network. Wait a few minutes." },
              { status: 429 },
            );
          }
        }
        return auth.handler(request);
      },
    },
  },
});
