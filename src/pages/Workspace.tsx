import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { projectApi, type Project } from '@/services/projectApi';

export default function Workspace() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true); setError(null);
    try { const list = await projectApi.list(); setProjects(list); } catch (e:any) { setError(e?.message || '加载失败'); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const createProject = async () => {
    const name = window.prompt('输入项目名称', '未命名项目') || undefined;
    const p = await projectApi.create({ name });
    // 跳转到工作界面，附带 projectId
    navigate(`/app?projectId=${p.id}`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-slate-50">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">我的工作</h1>
          <Button onClick={createProject}>新建项目</Button>
        </div>
        {loading && <div>加载中...</div>}
        {error && <div className="text-red-500">{error}</div>}
        {!loading && projects.length === 0 && (
          <Card className="p-8 text-center text-slate-500">暂无项目，点击右上角“新建项目”开始创作</Card>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map(p => (
            <Card key={p.id} className="p-4 hover:shadow cursor-pointer" onClick={() => navigate(`/app?projectId=${p.id}`)}>
              <div className="font-medium mb-1">{p.name}</div>
              <div className="text-xs text-slate-500">{new Date(p.createdAt).toLocaleString()}</div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

