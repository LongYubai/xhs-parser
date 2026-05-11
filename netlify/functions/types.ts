export interface XhsNote {
  id: string;
  title: string;
  description: string;
  author: {
    name: string;
    id: string;
    avatar: string;
  };
  images: string[];
  video: string | null;
  likes: number;
  collects: number;
  comments: number;
  tags: string[];
  url: string;
}

export interface ParseResult {
  success: true;
  data: XhsNote;
}

export interface ParseError {
  success: false;
  error: string;
  code: "INVALID_URL" | "NETWORK_ERROR" | "PARSE_ERROR" | "RATE_LIMITED" | "NOT_FOUND";
}

export type ParseResponse = ParseResult | ParseError;
