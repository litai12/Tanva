-- 004-align-tanva-rmb-pricing.sql
-- Purpose: align new-api fixed ModelPrice values with Tanva backend pricing.
--
-- Unit: RMB. new-api ModelPrice is consumed as a fixed RMB amount and Tanva
-- now treats new-api pricing as RMB 1:1. Dynamic per-duration/per-resolution
-- prices are defined in model/pricing.go; this patch fixes scalar fallbacks in
-- existing databases.

BEGIN;

INSERT INTO options (key, value)
VALUES (
  'ModelPrice',
  $json${
    "gemini-2.5-flash-image-preview": 0.2,
    "gemini-2.5-flash-image-preview-apimart": 0.2,
    "nano-banana-fast": 0.2,
    "nano-banana-fast-suchuang": 0.2,

    "gemini-3-pro-image-preview": 0.4,
    "gemini-3-pro-image-preview-apimart": 0.4,
    "gemini-3-pro-image-preview-official": 0.4,
    "nano-banana-pro": 0.4,
    "nano-banana-pro-suchuang": 0.4,

    "gemini-3.1-flash-image-preview": 0.3,
    "gemini-3.1-flash-image-preview-apimart": 0.3,
    "nanobanana2": 0.3,
    "nanobanana2-suchuang": 0.3,

    "gpt-image-2": 0.2,
    "gpt-image-2-all": 0.2,
    "gpt-image-2-apimart": 0.2,
    "gpt-image-2-suchuang": 0.2,
    "gpt-image-2-rightcodes": 0.2,
    "gpt-image-2-magic666": 0.2,
    "gpt-image-2-vip": 0.3,
    "gpt-image-2-vip-magic666": 0.3,
    "gpt-image-2-pro": 0.4,
    "gpt-image-2-pro-magic666": 0.4,
    "gpt-image-2-official": 0.4,

    "doubao-seedream-5-0": 0.3,
    "doubao-seedream-5-0-lite": 0.3,
    "doubao-seedream-5-0-260128": 0.3,
    "doubao-seedream-5-0-lite-260128": 0.3,

    "sora2": 2.0,
    "sora-2": 2.0,
    "sora-2-oai": 2.0,
    "sora-2-pro": 7.5,

    "wan2.7-videoedit": 6.0,
    "wan2.7-videoedit-apimart": 6.0,
    "wan-2.6": 4.0,
    "wan-2.6-r2v": 4.0,
    "wan-2.7": 4.0,
    "happyhorse-1.0-t2v": 6.0,
    "happyhorse-1.0-i2v": 6.0,
    "happyhorse-1.0-r2v": 6.0,
    "happyhorse-1.0-video-edit": 6.0,
    "kling-v2-6": 1.5,
    "kling-v2-6-apimart": 1.5,
    "kling-v3": 3.0,
    "kling-v3-apimart": 3.0,
    "kling-v3-omni": 3.0,
    "kling-v3-omni-apimart": 3.0,
    "vidu-q3": 1.25,
    "vidu-q3-tencent": 0.625
  }$json$
)
ON CONFLICT (key) DO UPDATE
SET value = (options.value::jsonb || EXCLUDED.value::jsonb)::text;

COMMIT;
