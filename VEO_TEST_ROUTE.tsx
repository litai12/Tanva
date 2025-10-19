/**
 * Veo 测试页面路由配置
 *
 * 在你的主路由文件中添加以下内容：
 */

import VeoTestPage from '@/pages/VeoTest';

// 添加到路由配置中：
export const veoTestRoute = {
  path: '/veo-test',
  element: <VeoTestPage />
};

// 或在 react-router 中：
// {
//   path: '/veo-test',
//   element: <VeoTestPage />
// }

// 在导航菜单中添加链接：
// <Link to="/veo-test">Veo 测试</Link>

// 或使用导航：
// navigate('/veo-test')
