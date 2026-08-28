/**
 * Obsidian-style context menu for Scribe.
 *
 * HTML shell owns the DOM; canvas owns the trigger. This module renders a
 * fixed-position VectoJS-agnostic menu: editor copy/cut/paste/select-all,
 * preview link open/copy, and generic canvas menu. Left-drag text selection
 * stays handled by the Scene/TextArea; we only intercept `contextmenu`.
 */

export type MenuItem = {
  id: string;
  label: string;
  accelerator?: string;
  disabled?: boolean;
  separator?: boolean;
};

export type ShowOptions = {
  x: number;
  y: number;
  items: MenuItem[];
  onSelect?: (id: string) => void | Promise<void>;
};

let cleanup: (() => void) | null = null;

export function getContextMenuEl(): HTMLElement | null {
  return document.getElementById('scribe-context-menu') as HTMLElement | null;
}

export function hideContextMenu(): void {
  const el = getContextMenuEl();
  if (!el) return;
  el.hidden = true;
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '';
  el.style.left = '-9999px';
  el.style.top = '-9999px';
  if (cleanup) {
    const fn = cleanup;
    cleanup = null;
    fn();
  }
}

export function isContextMenuVisible(): boolean {
  const el = getContextMenuEl();
  return !!el && !el.hidden;
}

function escapeLabel(s: string): string {
  // textContent escaping is done by DOM; this helper only for innerHTML fallback safety
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function showContextMenu(opts: ShowOptions): void {
  const el = getContextMenuEl();
  if (!el) return;
  hideContextMenu();

  el.hidden = false;
  el.setAttribute('aria-hidden', 'false');

  const list = document.createElement('ul');
  list.className = 'scribe-context-menu__list';
  list.setAttribute('role', 'menu');
  list.setAttribute('aria-label', 'Context menu');

  for (const item of opts.items) {
    if (item.separator) {
      const sep = document.createElement('li');
      sep.className = 'scribe-context-menu__separator';
      sep.setAttribute('role', 'separator');
      list.appendChild(sep);
      continue;
    }
    const li = document.createElement('li');
    li.setAttribute('role', 'none');
    const btn = document.createElement('button');
    btn.className = 'scribe-context-menu__item';
    btn.setAttribute('role', 'menuitem');
    btn.dataset.menuId = item.id;
    btn.type = 'button';
    if (item.disabled) {
      btn.setAttribute('aria-disabled', 'true');
      btn.disabled = true;
      btn.tabIndex = -1;
    } else {
      btn.tabIndex = 0;
    }

    const label = document.createElement('span');
    label.className = 'scribe-context-menu__label';
    label.textContent = item.label;
    // ensure label escapes automatically via textContent
    void escapeLabel;
    btn.appendChild(label);

    if (item.accelerator) {
      const acc = document.createElement('span');
      acc.className = 'scribe-context-menu__accel';
      acc.textContent = item.accelerator;
      btn.appendChild(acc);
    }

    if (!item.disabled) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = item.id;
        hideContextMenu();
        // defer onSelect so hide completes first
        setTimeout(() => {
          void opts.onSelect?.(id);
        }, 0);
      });
      btn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          btn.click();
        }
      });
    }

    li.appendChild(btn);
    list.appendChild(li);
  }

  el.appendChild(list);

  // Position after measuring; keep inside viewport with 8px margin.
  // Use fixed positioning relative to viewport.
  el.style.left = '0';
  el.style.top = '0';
  // Force layout
  const rect = el.getBoundingClientRect();
  const margin = 8;
  let left = opts.x;
  let top = opts.y;
  if (left + rect.width + margin > window.innerWidth) {
    left = Math.max(margin, window.innerWidth - rect.width - margin);
  }
  if (top + rect.height + margin > window.innerHeight) {
    top = Math.max(margin, window.innerHeight - rect.height - margin);
  }
  left = Math.max(margin, left);
  top = Math.max(margin, top);
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;

  const onClickOutside = (e: MouseEvent): void => {
    const target = e.target as Node | null;
    if (!target) return;
    if (el.contains(target)) return;
    hideContextMenu();
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      hideContextMenu();
    }
    // Arrow navigation
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const buttons = Array.from(
        el.querySelectorAll<HTMLButtonElement>('button.scribe-context-menu__item:not([disabled])'),
      );
      if (buttons.length === 0) return;
      const active = document.activeElement as HTMLButtonElement | null;
      const idx = buttons.indexOf(active as HTMLButtonElement);
      e.preventDefault();
      let next = 0;
      if (e.key === 'ArrowDown') next = idx < 0 ? 0 : (idx + 1) % buttons.length;
      else next = idx < 0 ? buttons.length - 1 : (idx - 1 + buttons.length) % buttons.length;
      buttons[next].focus();
    }
  };
  const onResize = (): void => {
    // Only hide if menu would be clipped after viewport change; keep during normal resize
    // that still fits (prevents preview ScrollView sync triggering window resize hide).
    try {
      const rect2 = el.getBoundingClientRect();
      const margin2 = 8;
      const fits =
        rect2.left >= margin2 &&
        rect2.top >= margin2 &&
        rect2.right + margin2 <= window.innerWidth &&
        rect2.bottom + margin2 <= window.innerHeight &&
        rect2.width > 0 &&
        rect2.height > 0;
      if (!fits) hideContextMenu();
    } catch {
      // ignore
    }
  };
  const onScroll = (): void => {
    // Do not hide on any scroll — preview ScrollView wheel sync bubbles as window scroll
    // and would dismiss the menu instantly ("right-click disappears quickly").
    // Only hide if menu is scrolled completely off-screen.
    try {
      const rect2 = el.getBoundingClientRect();
      const offscreen =
        rect2.bottom < 0 ||
        rect2.top > window.innerHeight ||
        rect2.right < 0 ||
        rect2.left > window.innerWidth;
      if (offscreen) hideContextMenu();
    } catch {
      // ignore
    }
  };
  const onContextOutside = (e: MouseEvent): void => {
    const target = e.target as Node | null;
    if (!target) return;
    if (el.contains(target)) {
      // right-click inside menu -> keep open, prevent browser menu
      e.preventDefault();
      return;
    }
    // another contextmenu elsewhere closes current
    hideContextMenu();
  };

  // Defer attaching so the triggering click doesn't immediately close.
  setTimeout(() => {
    document.addEventListener('click', onClickOutside);
    document.addEventListener('auxclick', onClickOutside as unknown as EventListener);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    document.addEventListener('contextmenu', onContextOutside);
  }, 0);

  cleanup = () => {
    document.removeEventListener('click', onClickOutside);
    document.removeEventListener('auxclick', onClickOutside as unknown as EventListener);
    document.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('scroll', onScroll, true);
    document.removeEventListener('contextmenu', onContextOutside);
  };

  // Focus first enabled item for keyboard
  const first = list.querySelector<HTMLButtonElement>('button:not([disabled])');
  // Use rAF to ensure element is laid out before focus
  requestAnimationFrame(() => first?.focus());
}
