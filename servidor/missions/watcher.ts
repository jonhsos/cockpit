import chokidar, { type FSWatcher } from "chokidar";
import { relative, sep } from "node:path";

const IGNORAR = /(^|[\\/])(node_modules|\.git|dist|\.cockpit)([\\/]|$)/;

const watchers = new Map<string, FSWatcher>();

/** Uma raiz observada por vez: o projeto e cada worktree de missão. */
export function observar(base: string, onChange: (path: string, base: string) => void): void {
  if (watchers.has(base)) return;
  const watcher = chokidar.watch(base, {
    ignored: IGNORAR,
    ignoreInitial: true,
    depth: 12,
  });
  const emitir = (caminho: string) =>
    onChange(relative(base, caminho).split(sep).join("/"), base);
  watcher.on("add", emitir).on("change", emitir).on("unlink", emitir);
  watchers.set(base, watcher);
}

export function parar(base: string): void {
  void watchers.get(base)?.close();
  watchers.delete(base);
}
