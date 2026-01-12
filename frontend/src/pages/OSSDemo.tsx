import { useState } from "react";
import { Button } from "@/components/ui/button";
import AccountBadge from "@/components/AccountBadge";

export default function OSSDemo() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    setUrl(null);
    try {
      // 1) 向后端请求预签策略（Nest）
      const API_BASE =
        import.meta.env.VITE_API_BASE_URL &&
        import.meta.env.VITE_API_BASE_URL.trim().length > 0
          ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, "")
          : "http://localhost:4000";

      const presignRes = await fetch(`${API_BASE}/api/uploads/presign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ dir: "uploads/", maxSize: 20 * 1024 * 1024 }),
      });
      const presign = await presignRes.json();
      if (!presignRes.ok) throw new Error(presign?.error || "获取上传策略失败");

      // 2) 直传到 OSS
      const filename = `${Date.now()}_${(file.name || "file").replace(
        /\s+/g,
        "_"
      )}`;
      const key = `${presign.dir}${filename}`;
      const fd = new FormData();
      fd.append("key", key);
      fd.append("policy", presign.policy);
      fd.append("OSSAccessKeyId", presign.accessId);
      fd.append("signature", presign.signature);
      fd.append("success_action_status", "200");
      fd.append("file", file);
      const ossResp = await fetch(presign.host, { method: "POST", body: fd });
      if (!ossResp.ok) throw new Error("OSS 上传失败");
      const publicUrl = `${presign.host}/${key}`;
      setUrl(publicUrl);
    } catch (e: any) {
      setError(e?.message || "上传失败");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className='min-h-screen w-full bg-gradient-to-b from-white to-sky-50 text-slate-800'>
      <header className='max-w-4xl mx-auto flex items-center justify-between py-6 px-4'>
        <div className='flex items-center gap-2'>
          <img src='/Logo.svg' alt='Tanvas' className='h-8 w-auto' />
          <span className='font-semibold text-2xl tracking-wide'>
            Tanvas OSS Demo
          </span>
        </div>
        <div className='flex items-center gap-4'>
          <AccountBadge />
          <a className='text-sky-600' href='/'>
            返回首页
          </a>
        </div>
      </header>

      <main className='max-w-4xl mx-auto px-4 pt-6 pb-24'>
        <div className='bg-white border rounded-2xl p-6 shadow-sm'>
          <div className='space-y-4'>
            <input
              type='file'
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className='block'
            />
            <Button onClick={onUpload} disabled={!file || uploading}>
              {uploading ? "上传中…" : "上传到 OSS"}
            </Button>
            {url && (
              <div className='text-sm'>
                上传成功：
                <a href={url} target='_blank' className='text-sky-600'>
                  {url}
                </a>
              </div>
            )}
            {error && <div className='text-sm text-red-500'>{error}</div>}
            <div className='text-xs text-slate-500'>
              注意：需要后端 Nest 配置 OSS（/api/uploads/presign）。
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
