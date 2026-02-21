import type {
  ApiMethods,
  Opts,
  Update,
} from "https://deno.land/x/grammy_types@v3.22.1/mod.ts";

import {
  login,
  type LoginResponse,
  search,
  verifyOtp,
} from "npm:truecallerjs@2.2.0";

type BotParams<METHOD extends keyof ApiMethods<unknown>> =
  & Opts<unknown>[METHOD]
  & { method: METHOD };

let tgChatId: number | undefined;

Deno.serve(async (request: Request) => {
  try {
    if (request.method !== "POST") {
      return new Response("OK");
    }

    let update: Update | undefined;

    try {
      update = await request.json();
    } catch {
      return new Response("Invalid JSON");
    }

    const message = update?.message;

    if (!message?.text) {
      return new Response("No message");
    }

    tgChatId = message.chat.id;

    const kv = await Deno.openKv();
    const chatIdKey: [string, number] = ["users", tgChatId];

    type KvValue =
      | { status: "awaiting_phone_no" }
      | { status: "awaiting_otp"; phoneNumber: string; loginResponse: LoginResponse }
      | { status: "logged_in"; installationId: string; countryCode: string }
      | { status: "logged_out" };

    const kvValue: KvValue =
      (await kv.get<KvValue>(chatIdKey)).value ?? { status: "logged_out" };

    // START
    if (message.text === "/start") {
      return sendTgMessage(
        "Use /login to login with your Truecaller account.",
      );
    }

    // LOGIN
    if (message.text === "/login") {
      await kv.set(chatIdKey, { status: "awaiting_phone_no" });
      return sendTgMessage("Enter phone number in +91 format:");
    }

    if (
      kvValue.status === "awaiting_phone_no" &&
      !message.text.startsWith("/")
    ) {
      if (!message.text.startsWith("+")) {
        return sendTgMessage("Phone must start with +");
      }

      let responseBody;
      try {
        responseBody = await login(message.text);
      } catch (err) {
        console.error(err);
        return sendTgMessage("Login failed. Try later.");
      }

      await kv.set(chatIdKey, {
        status: "awaiting_otp",
        phoneNumber: message.text,
        loginResponse: responseBody,
      });

      return sendTgMessage("Enter OTP:");
    }

    if (kvValue.status === "awaiting_otp" && !message.text.startsWith("/")) {
      let otpResponse;

      try {
        otpResponse = await verifyOtp(
          kvValue.phoneNumber,
          kvValue.loginResponse,
          message.text,
        );
      } catch (err) {
        console.error(err);
        return sendTgMessage("OTP verification failed.");
      }

      if (!otpResponse.installationId) {
        return sendTgMessage("Invalid OTP or login failed.");
      }

      await kv.set(chatIdKey, {
        status: "logged_in",
        installationId: otpResponse.installationId,
        countryCode: kvValue.loginResponse.parsedCountryCode,
      });

      return sendTgMessage("Login successful.");
    }

    if (message.text === "/logout") {
      await kv.delete(chatIdKey);
      return sendTgMessage("Logged out.");
    }

    if (kvValue.status !== "logged_in") {
      return sendTgMessage("Please /login first.");
    }

    // SEARCH
    let searchResult;
    try {
      searchResult = await search({
        number: message.text,
        countryCode: kvValue.countryCode,
        installationId: kvValue.installationId,
      });
    } catch (err) {
      console.error(err);
      return sendTgMessage("Search failed.");
    }

    return sendTgMessage(searchResult.getName() || "No result found.");
  } catch (error) {
    console.error("Fatal Error:", error);
    return new Response("OK"); // prevent Telegram 500
  }
});

function sendTgMessage(text: string) {
  if (!tgChatId) return new Response("OK");

  return new Response(
    JSON.stringify({
      method: "sendMessage",
      chat_id: tgChatId,
      text,
    } satisfies BotParams<"sendMessage">),
    { headers: { "Content-Type": "application/json" } },
  );
}
