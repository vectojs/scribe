import { CloudSyncStub } from '../model/cloudSync';

export function renderSync(
  container: HTMLElement,
  sync: CloudSyncStub,
  onUpdate?: () => void,
): void {
  container.innerHTML = '';
  const state = sync.getState();

  const title = document.createElement('h3');
  title.textContent = 'Sync';
  title.style.fontSize = '11px';
  title.style.fontWeight = '600';
  title.style.textTransform = 'uppercase';
  title.style.letterSpacing = '0.05em';
  title.style.color = '#6b6256';
  title.style.marginBottom = '8px';
  title.style.fontFamily = 'system-ui, sans-serif';
  container.appendChild(title);

  const status = document.createElement('p');
  status.textContent =
    state.provider === 'local'
      ? 'Local only (localStorage)'
      : `${state.provider} — last sync ${state.lastSyncAt ? new Date(state.lastSyncAt).toLocaleString() : 'never'}`;
  status.style.fontSize = '12px';
  status.style.color = '#8a8175';
  status.style.marginBottom = '8px';
  status.style.fontFamily = 'system-ui, sans-serif';
  container.appendChild(status);

  const hint = document.createElement('p');
  hint.textContent =
    'Cloud sync is a stub: localStorage is primary. GitHub/Drive hooks are placeholders (no secret commit).';
  hint.style.fontSize = '11px';
  hint.style.color = '#8a8175';
  hint.style.marginBottom = '12px';
  hint.style.fontFamily = 'system-ui, sans-serif';
  container.appendChild(hint);

  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.gap = '8px';
  row.style.flexWrap = 'wrap';

  const mkBtn = (label: string, handler: () => void | Promise<void>): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.fontSize = '12px';
    btn.style.fontFamily = 'system-ui, sans-serif';
    btn.style.padding = '6px 10px';
    btn.style.border = '1px solid #e5ddd3';
    btn.style.borderRadius = '6px';
    btn.style.background = '#fffdf9';
    btn.style.cursor = 'pointer';
    btn.style.color = '#3d3529';
    btn.addEventListener('click', () => {
      void handler();
    });
    return btn;
  };

  const githubBtn = mkBtn('Connect GitHub', async () => {
    await sync.connectGitHub('placeholder-token');
    renderSync(container, sync, onUpdate);
    onUpdate?.();
  });
  const driveBtn = mkBtn('Connect Drive', async () => {
    await sync.connectDrive('placeholder-token');
    renderSync(container, sync, onUpdate);
    onUpdate?.();
  });
  const syncBtn = mkBtn('Sync now', async () => {
    await sync.sync();
    renderSync(container, sync, onUpdate);
    onUpdate?.();
  });
  const localBtn = mkBtn('Use local', () => {
    sync.disable();
    renderSync(container, sync, onUpdate);
    onUpdate?.();
  });

  row.appendChild(githubBtn);
  row.appendChild(driveBtn);
  row.appendChild(syncBtn);
  row.appendChild(localBtn);
  container.appendChild(row);
}
