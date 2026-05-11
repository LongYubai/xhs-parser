import type { Context } from "@netlify/functions";
import type { ParseResponse } from "./types.js";
import { extractNoteUrl, parseNote } from "./parser.js";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function jsonResponse(body: ParseResponse, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
    },
  });
}

export default async function handler(req: Request, _context: Context): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  let input: string | null = null;

  if (req.method === "GET") {
    const url = new URL(req.url);
    input = url.searchParams.get("url");
  } else if (req.method === "POST") {
    try {
      const body = (await req.json()) as { url?: string };
      input = body.url ?? null;
    } catch {
      return jsonResponse(
        { success: false, error: "Invalid JSON body", code: "INVALID_URL" },
        400
      );
    }
  } else {
    return jsonResponse(
      { success: false, error: "Method not allowed", code: "INVALID_URL" },
      405
    );
  }

  if (!input) {
    return jsonResponse(
      { success: false, error: "Missing 'url' parameter", code: "INVALID_URL" },
      400
    );
  }

  const noteUrl = extractNoteUrl(input);
  if (!noteUrl) {
    return jsonResponse(
      { success: false, error: "Not a valid XHS URL or note ID", code: "INVALID_URL" },
      400
    );
  }

  const result = await parseNote(noteUrl);

  const statusCode = result.success
    ? 200
    : result.code === "RATE_LIMITED"
      ? 429
      : result.code === "NOT_FOUND"
        ? 404
        : result.code === "NETWORK_ERROR"
          ? 502
          : 422;

  return jsonResponse(result, statusCode);
}
