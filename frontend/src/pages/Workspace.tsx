import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { projectApi, type Project } from "@/services/projectApi";

export default function Workspace() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await projectApi.list();
      setProjects(list);
    } catch (e: any) {
      setError(e?.message || "加载失败");
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const createProject = async () => {
    const name = window.prompt("输入项目名称", "未命名项目") || undefined;
    const p = await projectApi.create({ name });
    // 跳转到工作界面，附带 projectId
    navigate(`/app?projectId=${p.id}`);
  };

  return (
    <div className='min-h-screen bg-slate-50'>
      <div className='max-w-7xl mx-auto px-4 py-10'>
        <div className='flex gap-8'>
          {/* 左侧导航栏（窄） */}
          <aside className='w-64 flex-shrink-0'>
            <div className='bg-white rounded-2xl shadow-sm border border-slate-100 p-4'>
              <div className='flex items-center gap-3'>
                <div className='w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-lg font-semibold text-blue-600'>
                  U
                </div>
                <div className='flex-1 min-w-0'>
                  <div className='text-sm font-medium text-slate-900'>
                    你好, 6774
                  </div>
                  <div className='text-xs text-slate-400'>
                    153****6774 · 专业版本
                  </div>
                </div>
              </div>
            </div>

            <div className='mt-6 space-y-3'>
              <button className='w-full text-left bg-white rounded-lg border p-3 shadow-sm hover:shadow-md flex items-center justify-between'>
                <span className='text-sm text-slate-700'>打开/管理文件</span>
              </button>
              <button className='w-full text-left bg-white rounded-lg border p-3 shadow-sm hover:shadow-md flex items-center justify-between'>
                <span className='text-sm text-slate-700'>返回首页</span>
              </button>
              <button className='w-full text-left bg-white rounded-lg border p-3 shadow-sm hover:shadow-md flex items-center justify-between'>
                <span className='text-sm text-slate-700'>全局图片历史</span>
              </button>
              <button className='w-full text-left bg-white rounded-lg border p-3 shadow-sm hover:shadow-md text-red-600'>
                <span className='text-sm'>清空画布内容</span>
              </button>
            </div>

            <div className='mt-6'>
              <div className='bg-white rounded-full w-12 h-12 flex items-center justify-center text-sm text-slate-700 shadow-sm'>
                6
              </div>
            </div>
          </aside>

          {/* 主内容区 */}
          <main className='flex-1'>
            <div className='grid grid-cols-1 lg:grid-cols-3 gap-6'>
              {/* 欢迎与积分卡片（跨两列） */}
              <Card className='col-span-1 lg:col-span-2 p-6 bg-white rounded-2xl'>
                <div className='flex items-center justify-between'>
                  <div>
                    <div className='text-sm text-slate-500'>你好, 6774</div>
                    <div className='text-3xl font-bold text-slate-900 mt-2'>
                      3271{" "}
                      <span className='text-base font-medium text-slate-500'>
                        积分
                      </span>
                    </div>
                    <div className='text-sm text-slate-400 mt-2'>
                      153****6774 · 专业版本
                    </div>
                  </div>
                  <div>
                    <Button
                      onClick={() => navigate("/")}
                      className='bg-white border'
                    >
                      立即充值
                    </Button>
                  </div>
                </div>

                <div className='mt-6 grid grid-cols-2 gap-3'>
                  <Button variant='outline' className='h-12 rounded-xl'>
                    打开/管理文件
                  </Button>
                  <Button
                    variant='outline'
                    className='h-12 rounded-xl'
                    onClick={() => navigate("/")}
                  >
                    返回首页
                  </Button>
                  <Button variant='outline' className='h-12 rounded-xl'>
                    全局图片历史
                  </Button>
                  <Button
                    variant='ghost'
                    className='h-12 rounded-xl text-red-600 border-red-200'
                  >
                    清空画布内容
                  </Button>
                </div>
              </Card>

              {/* 辅助卡片：快速操作或模板 */}
              <Card className='p-6 bg-white rounded-2xl'>
                <div className='text-sm font-medium text-slate-700 mb-2'>
                  快速操作
                </div>
                <div className='text-xs text-slate-500 mb-4'>
                  打开或管理项目，查看使用记录等
                </div>
                <div className='flex flex-col gap-3'>
                  <Button
                    onClick={() => navigate("/app")}
                    variant='outline'
                    className='rounded-xl'
                  >
                    进入画板
                  </Button>
                  <Button
                    onClick={() => createProject()}
                    className='rounded-xl'
                  >
                    新建项目
                  </Button>
                </div>
              </Card>
            </div>

            {/* 最近项目列表 */}
            <div className='mt-8'>
              <h2 className='text-lg font-semibold mb-4'>最近的项目</h2>
              {loading && (
                <div className='text-sm text-slate-500'>加载中...</div>
              )}
              {error && <div className='text-sm text-red-500'>{error}</div>}
              {!loading && projects.length === 0 && (
                <Card className='p-8 text-center text-slate-500'>
                  暂无项目，点击“新建项目”开始创作
                </Card>
              )}
              <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4'>
                {projects.map((p) => (
                  <Card
                    key={p.id}
                    className='p-4 hover:shadow cursor-pointer'
                    onClick={() => navigate(`/app?projectId=${p.id}`)}
                  >
                    <div className='font-medium mb-1'>{p.name}</div>
                    <div className='text-xs text-slate-500'>
                      {new Date(p.createdAt).toLocaleString()}
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
