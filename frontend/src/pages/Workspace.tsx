import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { projectApi, type Project } from "@/services/projectApi";
import LanguageSwitcher from "@/components/LanguageSwitcher";

export default function Workspace() {
  const { t } = useTranslation();
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
      setError(e?.message || t("workspacePage.loadFailed"));
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [t]);

  const createProject = async () => {
    const name =
      window.prompt(
        t("workspacePage.prompt.projectName"),
        t("workspacePage.prompt.defaultName")
      ) || undefined;
    const p = await projectApi.create({ name });
    navigate(`/app?projectId=${p.id}`);
  };

  return (
    <div className='min-h-screen bg-slate-50'>
      <div className='max-w-7xl mx-auto px-4 py-10'>
        <div className='flex justify-end mb-4'>
          <LanguageSwitcher style='simple' />
        </div>
        <div className='flex gap-8'>
          <aside className='w-64 flex-shrink-0'>
            <div className='bg-white rounded-2xl shadow-sm border border-slate-100 p-4'>
              <div className='flex items-center gap-3'>
                <div className='w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-lg font-semibold text-blue-600'>
                  U
                </div>
                <div className='flex-1 min-w-0'>
                  <div className='text-sm font-medium text-slate-900'>
                    {t("workspace.settings.workspaceTab.greeting", { name: "6774" })}
                  </div>
                  <div className='text-xs text-slate-400'>
                    {t("workspacePage.user.secondaryId")}
                  </div>
                </div>
              </div>
            </div>

            <div className='mt-6 space-y-3'>
              <button className='w-full text-left bg-white rounded-lg border p-3 shadow-sm hover:shadow-md flex items-center justify-between'>
                <span className='text-sm text-slate-700'>
                  {t("workspace.settings.workspaceTab.openManageFile")}
                </span>
              </button>
              <button className='w-full text-left bg-white rounded-lg border p-3 shadow-sm hover:shadow-md flex items-center justify-between'>
                <span className='text-sm text-slate-700'>
                  {t("workspace.settings.workspaceTab.backHome")}
                </span>
              </button>
              <button className='w-full text-left bg-white rounded-lg border p-3 shadow-sm hover:shadow-md flex items-center justify-between'>
                <span className='text-sm text-slate-700'>
                  {t("workspace.settings.workspaceTab.globalHistory")}
                </span>
              </button>
              <button className='w-full text-left bg-white rounded-lg border p-3 shadow-sm hover:shadow-md text-red-600'>
                <span className='text-sm'>{t("workspace.settings.workspaceTab.clearCanvas")}</span>
              </button>
            </div>

            <div className='mt-6'>
              <div className='bg-white rounded-full w-12 h-12 flex items-center justify-center text-sm text-slate-700 shadow-sm'>
                6
              </div>
            </div>
          </aside>

          <main className='flex-1'>
            <div className='grid grid-cols-1 lg:grid-cols-3 gap-6'>
              <Card className='col-span-1 lg:col-span-2 p-6 bg-white rounded-2xl'>
                <div className='flex items-center justify-between'>
                  <div>
                    <div className='text-sm text-slate-500'>
                      {t("workspace.settings.workspaceTab.greeting", { name: "6774" })}
                    </div>
                    <div className='text-3xl font-bold text-slate-900 mt-2'>
                      3271{" "}
                      <span className='text-base font-medium text-slate-500'>
                        {t("workspace.settings.workspaceTab.credits.unit")}
                      </span>
                    </div>
                    <div className='text-sm text-slate-400 mt-2'>
                      {t("workspacePage.user.secondaryId")}
                    </div>
                  </div>
                  <div>
                    <Button
                      onClick={() => navigate("/")}
                      className='bg-white border'
                    >
                      {t("workspace.settings.workspaceTab.credits.recharge")}
                    </Button>
                  </div>
                </div>

                <div className='mt-6 grid grid-cols-2 gap-3'>
                  <Button variant='outline' className='h-12 rounded-xl'>
                    {t("workspace.settings.workspaceTab.openManageFile")}
                  </Button>
                  <Button
                    variant='outline'
                    className='h-12 rounded-xl'
                    onClick={() => navigate("/")}
                  >
                    {t("workspace.settings.workspaceTab.backHome")}
                  </Button>
                  <Button variant='outline' className='h-12 rounded-xl'>
                    {t("workspace.settings.workspaceTab.globalHistory")}
                  </Button>
                  <Button
                    variant='ghost'
                    className='h-12 rounded-xl text-red-600 border-red-200'
                  >
                    {t("workspace.settings.workspaceTab.clearCanvas")}
                  </Button>
                </div>
              </Card>

              <Card className='p-6 bg-white rounded-2xl'>
                <div className='text-sm font-medium text-slate-700 mb-2'>
                  {t("workspacePage.quickActions.title")}
                </div>
                <div className='text-xs text-slate-500 mb-4'>
                  {t("workspacePage.quickActions.desc")}
                </div>
                <div className='flex flex-col gap-3'>
                  <Button
                    onClick={() => navigate("/app")}
                    variant='outline'
                    className='rounded-xl'
                  >
                    {t("workspacePage.quickActions.enterCanvas")}
                  </Button>
                  <Button
                    onClick={() => createProject()}
                    className='rounded-xl'
                  >
                    {t("workspacePage.quickActions.newProject")}
                  </Button>
                </div>
              </Card>
            </div>

            <div className='mt-8'>
              <h2 className='text-lg font-semibold mb-4'>{t("workspacePage.recentProjects.title")}</h2>
              {loading && (
                <div className='text-sm text-slate-500'>{t("workspace.settings.workspaceTab.loading")}</div>
              )}
              {error && <div className='text-sm text-red-500'>{error}</div>}
              {!loading && projects.length === 0 && (
                <Card className='p-8 text-center text-slate-500'>
                  {t("workspacePage.recentProjects.empty")}
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
