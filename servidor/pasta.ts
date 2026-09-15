import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Abre o seletor de pastas nativo do sistema operacional.
 *
 * O navegador não sabe o caminho real de uma pasta — o showDirectoryPicker dá
 * um handle, não um caminho, e o servidor precisa de caminho para criar
 * worktree e observar arquivos. Como o servidor roda na mesma máquina que a
 * tela, ele mesmo abre o diálogo nativo.
 *
 * No Windows, usa PowerShell com System.Windows.Forms.
 * No Linux, tenta zenity (GTK) ou kdialog (KDE).
 * No macOS, usa osascript (AppleScript).
 * Se nenhum seletor nativo existir, devolve { caminho: null, navegar: true }
 * para que o frontend abra o navegador de pastas embutido.
 */

// ── PowerShell script (Windows) ──
const SCRIPT_WIN = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$fonte = @'
using System;
using System.Runtime.InteropServices;
public class Frente {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
}
'@
Add-Type -TypeDefinition $fonte

$topo = New-Object System.Windows.Forms.Form
$topo.TopMost = $true
$topo.ShowInTaskbar = $false
$topo.FormBorderStyle = "None"
$topo.Size = New-Object System.Drawing.Size(1, 1)
$topo.StartPosition = "Manual"
$topo.Location = New-Object System.Drawing.Point(-2000, -2000)
$topo.Show()
$topo.Activate()
[void][Frente]::BringWindowToTop($topo.Handle)
[void][Frente]::SetForegroundWindow($topo.Handle)

$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = "Escolha a pasta do projeto"
$d.ShowNewFolderButton = $true
if ($d.ShowDialog($topo) -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.Write($d.SelectedPath)
}
$topo.Close()
$topo.Dispose()
`;

let caminhoScript: string | null = null;

function scriptEmDisco(): string {
  if (!caminhoScript) {
    caminhoScript = join(mkdtempSync(join(tmpdir(), "cockpit-")), "pasta.ps1");
    writeFileSync(caminhoScript, SCRIPT_WIN, "utf8");
  }
  return caminhoScript;
}

export type ResultadoPasta = { caminho: string | null; navegar?: boolean };

/** Testa se um comando existe no PATH. */
function temComando(cmd: string): boolean {
  try {
    execFileSync("which", [cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// ── Linux: tenta zenity, depois kdialog, senão pede o navegador embutido ──
function escolherPastaLinux(): Promise<ResultadoPasta> {
  if (temComando("zenity")) {
    return new Promise((resolve, reject) => {
      execFile(
        "zenity",
        ["--file-selection", "--directory", "--title=Escolha a pasta do projeto"],
        { timeout: 10 * 60_000 },
        (err, stdout) => {
          const caminho = stdout?.trim();
          if (caminho) return resolve({ caminho });
          if (!err) return resolve({ caminho: null });
          resolve({ caminho: null });
        },
      );
    });
  }
  if (temComando("kdialog")) {
    return new Promise((resolve) => {
      execFile(
        "kdialog",
        ["--getexistingdirectory", ".", "--title", "Escolha a pasta do projeto"],
        { timeout: 10 * 60_000 },
        (err, stdout) => {
          const caminho = stdout?.trim();
          if (caminho) return resolve({ caminho });
          resolve({ caminho: null });
        },
      );
    });
  }
  // Nenhum seletor nativo: pede ao frontend para abrir o navegador embutido.
  return Promise.resolve({ caminho: null, navegar: true });
}

// ── macOS: usa osascript ──
function escolherPastaMac(): Promise<ResultadoPasta> {
  return new Promise((resolve) => {
    execFile(
      "osascript",
      ["-e", 'choose folder with prompt "Escolha a pasta do projeto"'],
      { timeout: 10 * 60_000 },
      (err, stdout) => {
        if (err || !stdout?.trim()) return resolve({ caminho: null });
        // osascript devolve formato "alias Macintosh HD:Users:..." — converter
        const partes = stdout.trim().replace(/^alias /, "").split(":");
        partes.shift(); // remove o volume
        const caminho = "/" + partes.join("/");
        resolve({ caminho: caminho || null });
      },
    );
  });
}

// ── Windows: PowerShell ──
function escolherPastaWin(): Promise<ResultadoPasta> {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell",
      ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", scriptEmDisco()],
      // Sem pressa: o diálogo fica aberto até você escolher.
      { timeout: 10 * 60_000, windowsHide: true },
      (err, stdout, stderr) => {
        const caminho = stdout.trim();
        if (caminho) return resolve({ caminho });
        // Fechar o diálogo pelo X faz o PowerShell sair com código não-zero
        // sem escrever nada: isso é cancelamento, não falha.
        if (err && stderr.trim()) {
          reject(new Error(`o seletor de pastas falhou: ${stderr.trim().split("\n")[0]}`));
        } else {
          resolve({ caminho: null });
        }
      },
    );
  });
}

export function escolherPasta(): Promise<ResultadoPasta> {
  if (process.platform === "win32") return escolherPastaWin();
  if (process.platform === "darwin") return escolherPastaMac();
  return escolherPastaLinux();
}
