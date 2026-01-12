import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Res,
} from "@nestjs/common";
import { ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import type { FastifyReply } from "fastify";
import { OssService } from "./oss.service";

@ApiTags("assets")
@Controller("assets")
export class AssetsController {
  constructor(private readonly oss: OssService) {}

  private resolveTargetUrl(params: { url?: string; key?: string }): string {
    const key = typeof params.key === "string" ? params.key.trim() : "";
    if (key) {
      return this.oss.publicUrl(key.replace(/^\/+/, ""));
    }

    const url = typeof params.url === "string" ? params.url.trim() : "";
    if (!url) {
      throw new BadRequestException("Missing `url` or `key`");
    }
    return url;
  }

  private isAllowedHost(hostname: string): boolean {
    const allowed = new Set(this.oss.allowedPublicHosts());
    return allowed.has(hostname);
  }

  @Get("proxy")
  @ApiOperation({ summary: "Proxy public OSS assets to avoid browser CORS" })
  @ApiQuery({
    name: "url",
    required: false,
    description: "Full remote URL (must be an allowed OSS/CDN host)",
  })
  @ApiQuery({
    name: "key",
    required: false,
    description: "OSS object key (alternative to url)",
  })
  async proxy(
    @Res() reply: FastifyReply,
    @Query("url") url?: string,
    @Query("key") key?: string
  ) {
    const targetUrl = this.resolveTargetUrl({ url, key });

    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch {
      throw new BadRequestException("Invalid URL");
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new BadRequestException("Unsupported URL protocol");
    }

    // Allow proxying for common presigned URLs (e.g. AWS S3 presigned: contains X-Amz-*)
    // or for hosts that include 's3' / 'amazonaws' — these are commonly used for temporary video URLs.
    // This avoids rejecting valid presigned links that are not listed in the OSS whitelist.
    const isPresignedLike =
      /[?&]X-Amz[-_]/i.test(targetUrl) ||
      /x-amz-/i.test(targetUrl) ||
      parsed.hostname.toLowerCase().includes("amazonaws") ||
      parsed.hostname.toLowerCase().includes(".s3.");

    if (!isPresignedLike && !this.isAllowedHost(parsed.hostname)) {
      throw new BadRequestException("Host not allowed");
    }

    const upstream = await fetch(targetUrl, { redirect: "follow" });

    const contentType = upstream.headers.get("content-type");
    if (contentType) reply.header("content-type", contentType);

    // 仅对成功响应缓存，避免把偶发的 4xx/5xx “缓存成空白图”。
    if (upstream.ok) {
      const cacheControl = upstream.headers.get("cache-control");
      reply.header("cache-control", cacheControl || "public, max-age=3600");
    } else {
      reply.header("cache-control", "no-store");
    }

    const etag = upstream.headers.get("etag");
    if (etag) reply.header("etag", etag);

    const lastModified = upstream.headers.get("last-modified");
    if (lastModified) reply.header("last-modified", lastModified);

    reply.status(upstream.status);

    const body = Buffer.from(await upstream.arrayBuffer());
    reply.send(body);
  }
}
