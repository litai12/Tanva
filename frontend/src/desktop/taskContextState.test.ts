import assert from 'node:assert/strict';
import test from 'node:test';
import { useDesktopTaskContextStore } from './taskContextState.ts';

test('desktop tasks retain independent project bindings', () => {
  useDesktopTaskContextStore.setState({
    projectBySessionId: {},
    modeBySessionId: {},
    collapsedProjectIds: {},
    pinnedProjectIds: {},
    pinnedSessionIds: {},
    archivedSessionIds: {},
    workCollapsed: false,
    chatCollapsed: false,
    sidebarVisible: true,
    sidebarWidth: 272,
  });
  const state = useDesktopTaskContextStore.getState();
  state.bindProject('task-a', 'project-1');
  state.bindProject('task-b', 'project-2');
  assert.deepEqual(useDesktopTaskContextStore.getState().projectBySessionId, {
    'task-a': 'project-1',
    'task-b': 'project-2',
  });
  assert.deepEqual(useDesktopTaskContextStore.getState().modeBySessionId, {
    'task-a': 'work',
    'task-b': 'work',
  });
});

test('deleting a task removes only its project binding', () => {
  useDesktopTaskContextStore.getState().removeSession('task-a');
  assert.deepEqual(useDesktopTaskContextStore.getState().projectBySessionId, {
    'task-b': 'project-2',
  });
});

test('moving a work task back to chat removes the project binding', () => {
  useDesktopTaskContextStore.getState().moveToChat('task-b');
  assert.deepEqual(useDesktopTaskContextStore.getState().projectBySessionId, {});
  assert.equal(useDesktopTaskContextStore.getState().modeBySessionId['task-b'], 'chat');
});

test('deleting a project moves only its bound tasks back to chat', () => {
  const state = useDesktopTaskContextStore.getState();
  state.bindProject('task-a', 'project-1');
  state.bindProject('task-b', 'project-2');
  state.toggleProjectCollapsed('project-1');
  state.removeProject('project-1');

  assert.deepEqual(useDesktopTaskContextStore.getState().projectBySessionId, {
    'task-b': 'project-2',
  });
  assert.equal(useDesktopTaskContextStore.getState().modeBySessionId['task-a'], 'chat');
  assert.equal(useDesktopTaskContextStore.getState().modeBySessionId['task-b'], 'work');
  assert.equal(useDesktopTaskContextStore.getState().collapsedProjectIds['project-1'], undefined);
});

test('project collapsed state is persisted independently', () => {
  const state = useDesktopTaskContextStore.getState();
  state.toggleProjectCollapsed('project-2');
  assert.equal(useDesktopTaskContextStore.getState().collapsedProjectIds['project-2'], true);
  state.toggleProjectCollapsed('project-2');
  assert.equal(useDesktopTaskContextStore.getState().collapsedProjectIds['project-2'], false);
});

test('work directory can be collapsed and a project drop expands the full path', () => {
  const state = useDesktopTaskContextStore.getState();
  state.toggleWorkCollapsed();
  state.toggleProjectCollapsed('project-2');
  assert.equal(useDesktopTaskContextStore.getState().workCollapsed, true);
  assert.equal(useDesktopTaskContextStore.getState().collapsedProjectIds['project-2'], true);

  state.bindProject('task-c', 'project-2');
  assert.equal(useDesktopTaskContextStore.getState().workCollapsed, false);
  assert.equal(useDesktopTaskContextStore.getState().collapsedProjectIds['project-2'], false);
});

test('projects and conversations retain Codex-style navigation preferences', () => {
  const state = useDesktopTaskContextStore.getState();
  state.toggleProjectPinned('project-2');
  state.toggleSessionPinned('task-c');
  state.toggleChatCollapsed();

  assert.equal(useDesktopTaskContextStore.getState().pinnedProjectIds['project-2'], true);
  assert.equal(useDesktopTaskContextStore.getState().pinnedSessionIds['task-c'], true);
  assert.equal(useDesktopTaskContextStore.getState().chatCollapsed, true);

  state.setSessionArchived('task-c', true);
  assert.equal(useDesktopTaskContextStore.getState().archivedSessionIds['task-c'], true);
  assert.equal(useDesktopTaskContextStore.getState().pinnedSessionIds['task-c'], undefined);

  state.setSessionArchived('task-c', false);
  assert.equal(useDesktopTaskContextStore.getState().archivedSessionIds['task-c'], undefined);
});

test('sidebar visibility and width follow desktop safety bounds', () => {
  const state = useDesktopTaskContextStore.getState();
  state.toggleSidebar();
  assert.equal(useDesktopTaskContextStore.getState().sidebarVisible, false);
  state.toggleSidebar();
  assert.equal(useDesktopTaskContextStore.getState().sidebarVisible, true);

  state.setSidebarWidth(100);
  assert.equal(useDesktopTaskContextStore.getState().sidebarWidth, 232);
  state.setSidebarWidth(900);
  assert.equal(useDesktopTaskContextStore.getState().sidebarWidth, 420);
});
