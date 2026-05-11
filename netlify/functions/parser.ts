import type { ParseResponse } from "./types.js";

const XHS_SHORT_LINK_RE = /xhslink\.com\/[A-Za-z0-9]+/;
const XHS_NOTE_RE = /xiaohongshu\.com\/(?:explore|discovery\/item)\/([a-f0-9]{24})/;
const XHS_NOTE_ID_RE = /^[a-f0-9]{24}$/;

export function extractNoteUrl(input: string): string | null {
  const trimmed = input.trim();

  if (XHS_NOTE_ID_RE.test(trimmed)) {
    return `https://www.xiaohongshu.com/explore/${trimmed}`;
  }

  const noteMatch = trimmed.match(XHS_NOTE_RE);
  if (noteMatch) {
    return `https://www.xiaohongshu.com/explore/${noteMatch[1]}`;
  }

  if (XHS_SHORT_LINK_RE.test(trimmed)) {
    const urlMatch = trimmed.match(/https?:\/\/xhslink\.com\/[A-Za-z0-9]+/);
    return urlMatch ? urlMatch[0] : null;
  }

  const embeddedUrl = trimmed.match(/https?:\/\/(?:www\.)?xiaohongshu\.com\/(?:explore|discovery\/item)\/[a-f0-9]{24}[^\s]*/);
  if (embeddedUrl) {
    return embeddedUrl[0].split("?")[0];
  }

  const embeddedShort = trimmed.match(/https?:\/\/xhslink\.com\/[A-Za-z0-9]+/);
  if (embeddedShort) {
    return embeddedShort[0];
  }

  return null;
}

async function resolveShortLink(url: string): Promise<string> {
  const resp = await fetch(url, {
    method: "GET",
    redirect: "manual",
    headers: {
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    },
  });

  const location = resp.headers.get("location");
  if (!location) {
    throw new Error("Short link did not redirect");
  }

  const noteMatch = location.match(XHS_NOTE_RE);
  if (!noteMatch) {
    throw new Error("Redirect did not point to a valid XHS note");
  }

  return `https://www.xiaohongshu.com/explore/${noteMatch[1]}`;
}

function extractJsonLd(html: string): Record<string, unknown> | null {
  const match = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function extractInitialState(html: string): Record<string, unknown> | null {
  // Try multiple patterns - XHS sometimes uses different formats
  const patterns = [
    /window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?})\s*<\/script>/,
    /window\.__INITIAL_STATE__\s*=\s*({.+?})\s*;?\s*(?:<\/script>|$)/m,
    /window\.__INITIAL_STATE__\s*=\s*(.+)/,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) continue;
    try {
      const cleaned = match[1]
        .replace(/undefined/g, "null")
        .replace(/\\u002F/g, "/");
      const parsed = JSON.parse(cleaned);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      continue;
    }
  }
  return null;
}

function extractMetaContent(html: string, property: string): string {
  const re = new RegExp(`<meta[^>]*(?:property|name)=["']${property}["'][^>]*content=["']([^"']*)["']`, "i");
  const match = html.match(re);
  if (match) return match[1];

  const reAlt = new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${property}["']`, "i");
  const matchAlt = html.match(reAlt);
  return matchAlt ? matchAlt[1] : "";
}

function extractImages(html: string, state: Record<string, unknown> | null): string[] {
  if (state) {
    try {
      const noteState = state["note"] as Record<string, unknown> | undefined;
      const noteDetailMap = noteState?.["noteDetailMap"] as Record<string, unknown> | undefined;
      if (noteDetailMap) {
        const firstKey = Object.keys(noteDetailMap)[0];
        const detail = noteDetailMap[firstKey] as Record<string, unknown> | undefined;
        const note = detail?.["note"] as Record<string, unknown> | undefined;
        const imageList = note?.["imageList"] as Array<Record<string, unknown>> | undefined;
        if (imageList?.length) {
          return imageList
            .map((img) => {
              const urlPre = img["urlPre"] as string | undefined;
              const urlDefault = img["urlDefault"] as string | undefined;
              const url = img["url"] as string | undefined;
              return urlPre || urlDefault || url || "";
            })
            .filter(Boolean);
        }
      }
    } catch {
      // fall through to og:image
    }
  }

  const ogImage = extractMetaContent(html, "og:image");
  return ogImage ? [ogImage] : [];
}

function extractVideo(state: Record<string, unknown> | null): string | null {
  if (!state) return null;
  try {
    const noteState = state["note"] as Record<string, unknown> | undefined;
    const noteDetailMap = noteState?.["noteDetailMap"] as Record<string, unknown> | undefined;
    if (!noteDetailMap) return null;
    const firstKey = Object.keys(noteDetailMap)[0];
    const detail = noteDetailMap[firstKey] as Record<string, unknown> | undefined;
    const note = detail?.["note"] as Record<string, unknown> | undefined;
    const video = note?.["video"] as Record<string, unknown> | undefined;
    if (!video) return null;
    const media = video["media"] as Record<string, unknown> | undefined;
    const stream = media?.["stream"] as Record<string, unknown> | undefined;
    const h264 = stream?.["h264"] as Array<Record<string, unknown>> | undefined;
    if (h264?.length) {
      return (h264[0]["masterUrl"] as string) || null;
    }
  } catch {
    // no video
  }
  return null;
}

function extractInteractionCount(state: Record<string, unknown> | null, key: string): number {
  if (!state) return 0;
  try {
    const noteState = state["note"] as Record<string, unknown> | undefined;
    const noteDetailMap = noteState?.["noteDetailMap"] as Record<string, unknown> | undefined;
    if (!noteDetailMap) return 0;
    const firstKey = Object.keys(noteDetailMap)[0];
    const detail = noteDetailMap[firstKey] as Record<string, unknown> | undefined;
    const note = detail?.["note"] as Record<string, unknown> | undefined;
    const interactInfo = note?.["interactInfo"] as Record<string, unknown> | undefined;
    const val = interactInfo?.[key];
    return typeof val === "number" ? val : typeof val === "string" ? parseInt(val, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

function extractTags(html: string, state: Record<string, unknown> | null): string[] {
  if (state) {
    try {
      const noteState = state["note"] as Record<string, unknown> | undefined;
      const noteDetailMap = noteState?.["noteDetailMap"] as Record<string, unknown> | undefined;
      if (noteDetailMap) {
        const firstKey = Object.keys(noteDetailMap)[0];
        const detail = noteDetailMap[firstKey] as Record<string, unknown> | undefined;
        const note = detail?.["note"] as Record<string, unknown> | undefined;
        const tagList = note?.["tagList"] as Array<Record<string, unknown>> | undefined;
        if (tagList?.length) {
          return tagList.map((t) => (t["name"] as string) || "").filter(Boolean);
        }
      }
    } catch {
      // fall through
    }
  }

  const tags: string[] = [];
  const hashtagRe = /#([^#\s<]+)/g;
  const description = extractMetaContent(html, "og:description") || extractMetaContent(html, "description");
  let m;
  while ((m = hashtagRe.exec(description)) !== null) {
    tags.push(m[1]);
  }
  return tags;
}

function extractAuthor(html: string, state: Record<string, unknown> | null): { name: string; id: string; avatar: string } {
  if (state) {
    try {
      const noteState = state["note"] as Record<string, unknown> | undefined;
      const noteDetailMap = noteState?.["noteDetailMap"] as Record<string, unknown> | undefined;
      if (noteDetailMap) {
        const firstKey = Object.keys(noteDetailMap)[0];
        const detail = noteDetailMap[firstKey] as Record<string, unknown> | undefined;
        const note = detail?.["note"] as Record<string, unknown> | undefined;
        const user = note?.["user"] as Record<string, unknown> | undefined;
        if (user) {
          return {
            name: (user["nickname"] as string) || "",
            id: (user["userId"] as string) || "",
            avatar: (user["avatar"] as string) || "",
          };
        }
      }
    } catch {
      // fall through
    }
  }

  return {
    name: extractMetaContent(html, "og:xhs:note:author"),
    id: "",
    avatar: "",
  };
}

export async function parseNote(noteUrl: string): Promise<ParseResponse> {
  let finalUrl = noteUrl;

  if (noteUrl.includes("xhslink.com")) {
    try {
      finalUrl = await resolveShortLink(noteUrl);
    } catch {
      return { success: false, error: "Failed to resolve short link", code: "NETWORK_ERROR" };
    }
  }

  const noteIdMatch = finalUrl.match(/\/([a-f0-9]{24})/);
  if (!noteIdMatch) {
    return { success: false, error: "Could not extract note ID from URL", code: "PARSE_ERROR" };
  }
  const noteId = noteIdMatch[1];

  let html: string;
  try {
    const resp = await fetch(finalUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Cookie": "xsecappid=xhs-pc-web",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
      },
    });

    if (resp.status === 429) {
      return { success: false, error: "Rate limited by XHS", code: "RATE_LIMITED" };
    }
    if (resp.status === 404) {
      return { success: false, error: "Note not found", code: "NOT_FOUND" };
    }
    if (!resp.ok) {
      return { success: false, error: `HTTP ${resp.status} from XHS`, code: "NETWORK_ERROR" };
    }

    html = await resp.text();
  } catch (err) {
    return {
      success: false,
      error: `Network error: ${err instanceof Error ? err.message : String(err)}`,
      code: "NETWORK_ERROR",
    };
  }

  const state = extractInitialState(html);
  const jsonLd = extractJsonLd(html);

  const title =
    (jsonLd?.["name"] as string) ||
    extractMetaContent(html, "og:title") ||
    "";

  const description =
    (jsonLd?.["description"] as string) ||
    extractMetaContent(html, "og:description") ||
    extractMetaContent(html, "description") ||
    "";

  const author = extractAuthor(html, state);
  const images = extractImages(html, state);
  const video = extractVideo(state);
  const tags = extractTags(html, state);

  const likes = extractInteractionCount(state, "likedCount");
  const collects = extractInteractionCount(state, "collectedCount");
  const comments = extractInteractionCount(state, "commentCount");

  return {
    success: true,
    data: {
      id: noteId,
      title,
      description,
      author,
      images,
      video,
      likes,
      collects,
      comments,
      tags,
      url: `https://www.xiaohongshu.com/explore/${noteId}`,
    },
  };
}
