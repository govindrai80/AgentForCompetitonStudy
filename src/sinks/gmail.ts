import fs from "node:fs";
import http from "node:http";
import { AddressInfo } from "node:net";
import { google } from "googleapis";
import { log } from "../util/logger.js";

/**
 * Creates a Gmail *draft*. It never calls messages.send — review and sending
 * stay a human action, deliberately.
 *
 * Note on scope: Gmail has no draft-only scope. `gmail.compose` is the
 * narrowest one that can create a draft, and it does technically also permit
 * sending. Nothing in this file calls send; if that isn't a strong enough
 * guarantee for your threat model, use the file output and paste manually.
 */
const SCOPES = ["https://www.googleapis.com/auth/gmail.compose"];

export interface GmailDraftInput {
  to?: string;
  subject: string;
  body: string;
  from?: string;
}

export async function createGmailDraft(input: GmailDraftInput): Promise<{ id: string; url: string }> {
  const auth = await authorize();
  const gmail = google.gmail({ version: "v1", auth });

  const res = await gmail.users.drafts.create({
    userId: "me",
    requestBody: { message: { raw: buildRaw(input) } },
  });

  const id = res.data.id;
  const messageId = res.data.message?.id;
  if (!id) throw new Error("Gmail accepted the request but returned no draft id.");

  return {
    id,
    url: messageId
      ? `https://mail.google.com/mail/u/0/#drafts?compose=${messageId}`
      : "https://mail.google.com/mail/u/0/#drafts",
  };
}

/** RFC 2822 message, base64url-encoded as the Gmail API expects. */
function buildRaw(input: GmailDraftInput): string {
  const headers = [
    input.to ? `To: ${input.to}` : null,
    input.from ? `From: ${input.from}` : null,
    `Subject: ${encodeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ].filter(Boolean);

  const body = Buffer.from(input.body, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  const message = `${headers.join("\r\n")}\r\n\r\n${body}`;
  return Buffer.from(message, "utf8").toString("base64url");
}

/** RFC 2047 encoded-word, so non-ASCII subjects survive the transport. */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

async function authorize() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Gmail output needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env. " +
        "See the 'Gmail setup' section of the README.",
    );
  }
  const tokenPath = process.env.GMAIL_TOKEN_PATH ?? ".gmail-token.json";

  if (fs.existsSync(tokenPath)) {
    const client = new google.auth.OAuth2(clientId, clientSecret);
    client.setCredentials(JSON.parse(fs.readFileSync(tokenPath, "utf8")));
    // Persist refreshed access tokens so consent stays a one-time event.
    client.on("tokens", (tokens) => {
      const merged = { ...JSON.parse(fs.readFileSync(tokenPath, "utf8")), ...tokens };
      fs.writeFileSync(tokenPath, JSON.stringify(merged, null, 2), { mode: 0o600 });
    });
    return client;
  }

  return consentFlow(clientId, clientSecret, tokenPath);
}

/**
 * One-time browser consent against a loopback redirect. Desktop-app OAuth
 * clients accept any http://localhost port, so nothing needs registering
 * beyond creating the client in Google Cloud Console.
 */
function consentFlow(clientId: string, clientSecret: string, tokenPath: string) {
  return new Promise<InstanceType<typeof google.auth.OAuth2>>((resolve, reject) => {
    const server = http.createServer();

    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      const redirectUri = `http://localhost:${port}`;
      const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

      const authUrl = client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: SCOPES,
      });

      log.info("Gmail authorisation needed. Open this URL and grant access:");
      console.error(`\n  ${authUrl}\n`);

      const timeout = setTimeout(
        () => {
          server.close();
          reject(new Error("Gmail authorisation timed out after 5 minutes."));
        },
        5 * 60 * 1000,
      );

      server.on("request", async (req, res) => {
        const url = new URL(req.url ?? "/", redirectUri);
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");

        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(code ? "Authorised. You can close this tab." : `Authorisation failed: ${error ?? "no code"}`);

        clearTimeout(timeout);
        server.close();

        if (!code) return reject(new Error(`Gmail authorisation failed: ${error ?? "no code returned"}`));
        try {
          const { tokens } = await client.getToken(code);
          client.setCredentials(tokens);
          fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2), { mode: 0o600 });
          log.ok(`Gmail token cached at ${tokenPath} (chmod 600, gitignored).`);
          resolve(client);
        } catch (e) {
          reject(e as Error);
        }
      });
    });

    server.on("error", reject);
  });
}
