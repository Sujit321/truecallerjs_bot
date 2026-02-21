import type { Update } from "https://deno.land/x/grammy_types@v3.22.1/mod.ts";
import {
  login,
  type LoginResponse,
  search,
  verifyOtp,
} from "npm:truecallerjs@2.2.0";

const BOT_TOKEN = Deno.env.get("TG_THIS_BOT_TOKEN");

if (!BOT_TOKEN) {
  console.error("TG_THIS_BOT_TOKEN is missing!");
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return new Response("OK");
    }

    let update: Update | undefined;

    try {
      update = await req.json();
    } catch (e) {
      console.error("Invalid JSON:", e);
      return new Response("OK");
    }

    const message = update?.message;
    if (!message?.text) {
      return new Response("OK");
    }

    const chatId = message.chat.id;
    const text = message.text;

    const kv = await Deno.openKv();
    const key: [string, number] = ["users", chatId];

    type KvValue =
      | { status: "awaiting_phone" }
      | { status: "awaiting_otp"; phone: string; loginResponse: LoginResponse }
      | { status: "logged_in"; installationId: string; countryCode: string }
      | { status: "logged_out" };

    const state: KvValue =
      (await kv.get<KvValue>(key)).value ?? { status: "logged_out" };

    // START
    if (text === "/start") {
      await sendMessage(chatId, "Use /login to begin.");
      return new Response("OK");
    }

    // LOGIN COMMAND
    if (text === "/login") {
      await kv.set(key, { status: "awaiting_phone" });
      await sendMessage(chatId, "Enter phone number in +91 format:");
      return new Response("OK");
    }

    // PHONE INPUT
    if (state.status === "awaiting_phone" && !text.startsWith("/")) {
      if (!text.startsWith("+")) {
        await sendMessage(chatId, "Phone must start with +");
        return new Response("OK");
      }

      let response;
      try {
        response = await login(text);
      } catch (err) {
        console.error("Login error:", err);
        await sendMessage(chatId, "Login failed. Try again later.");
        return new Response("OK");
      }

      await kv.set(key, {
        status: "awaiting_otp",
        phone: text,
        loginResponse: response,
      });

      await sendMessage(chatId, "Enter OTP:");
      return new Response("OK");
    }

    // OTP INPUT
    if (state.status === "awaiting_otp" && !text.startsWith("/")) {
      let otpResponse;

      try {
        otpResponse = await verifyOtp(
          state.phone,
          state.loginResponse,
          text,
        );
      } catch (err) {
        console.error("OTP error:", err);
        await sendMessage(chatId, "OTP verification failed.");
        return new Response("OK");
      }

      if (!otpResponse.installationId) {
        await sendMessage(chatId, "Invalid OTP.");
        return new Response("OK");
      }

      await kv.set(key, {
        status: "logged_in",
        installationId: otpResponse.installationId,
        countryCode: state.loginResponse.parsedCountryCode,
      });

      await sendMessage(chatId, "Login successful.");
      return new Response("OK");
    }

    // LOGOUT
    if (text === "/logout") {
      await kv.delete(key);
      await sendMessage(chatId, "Logged out.");
      return new Response("OK");
    }

    // SEARCH
    if (state.status !== "logged_in") {
      await sendMessage(chatId, "Please /login first.");
      return new Response("OK");
    }

    let result;
    try {
      result = await search({
        number: text,
        countryCode: state.countryCode,
        installationId: state.installationId,
      });
    } catch (err) {
      console.error("Search error:", err);
      await sendMessage(chatId, "Search failed.");
      return new Response("OK");
    }

    await sendMessage(chatId, result.getName() || "No result found.");
    return new Response("OK");

  } catch (err) {
    console.error("Fatal error:", err);
    return new Response("OK"); // prevent Telegram 500
  }
});

async function sendMessage(chatId: number, text: string) {
  if (!BOT_TOKEN) return;

  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
    }),
  });
}
