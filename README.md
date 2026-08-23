<p align="center">
  <img src="docs/assets/readme/media-organizer-hero.webp" alt="Photos and videos flowing through private local processing into an organized media library" width="100%">
</p>

<h1 align="center">Media Organizer</h1>

<p align="center">
  <strong>Bring order to your photo and video library — locally, safely, and at your pace.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-22.13%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js 22.13 or newer">
  <img src="https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript 5.8">
  <img src="https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=0B1220" alt="React 18">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-64748B?style=flat-square" alt="Windows, macOS, and Linux">
  <img src="https://img.shields.io/badge/local--first-your%20files%20stay%20yours-2F8F65?style=flat-square" alt="Local-first">
  <img src="https://img.shields.io/badge/status-active%20development-F59E0B?style=flat-square" alt="Under active development">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-2F8F65?style=flat-square" alt="MIT License"></a>
</p>

<p align="center">
  <a href="#-why-media-organizer">Why</a> ·
  <a href="#-what-it-can-do">Features</a> ·
  <a href="#-quick-start">Quick Start</a> ·
  <a href="#-platform-setup">Platform Setup</a> ·
  <a href="#-development">Development</a> ·
  <a href="#-documentation">Documentation</a>
</p>

---

## 🌿 Why Media Organizer?

Large phone exports tend to become a mix of photos, videos, screenshots, duplicates, unclear filenames, and half-finished backup folders. Media Organizer turns that manual cleanup into a preview-driven workflow that remains under your control.

- **Local-first:** media is processed on your computer and is only uploaded when you explicitly choose a cloud export.
- **Preview before action:** choose folders, review the detected media, and adjust the proposed organization before files change.
- **Resume safely:** long-running compression and grouping jobs persist their state so you can pause and continue later.
- **One guided flow:** import, select, compress, organize, and export from a single dashboard.

> [!IMPORTANT]
> Media Organizer is an advanced local beta with end-to-end workflows that operate on real files. Keep an independent backup of important media and review each preview before applying filesystem changes.

## ✨ What it can do

| | Capability | What it gives you |
|---|---|---|
| 📥 | **Import and scan** | Select local source and destination folders and scan nested photo/video collections. |
| 🔎 | **Review and select** | Preview detected media and decide what belongs in the processing scope. |
| 🗜️ | **Compress** | Compress JPEG/HEIC images and videos with configurable quality and encoder settings. |
| 🗂️ | **Organize** | Build and adjust folder groupings using dates and filename patterns before applying them. |
| ⏯️ | **Pause and resume** | Continue long-running compression and grouping sessions without starting over. |
| 📤 | **Export** | Copy organized output to local or network destinations, or upload grouped albums through the built-in Google Photos export flow. |
| 📊 | **Track results** | Review execution history, saved space, processing duration, and verification status. |

### The workflow

```text
Import → Selection → Compression → Grouping → Export
```

Every filesystem-writing step is explicit. The dashboard keeps the proposed result visible before you apply it.

Google Photos export is available today for organized output uploads. It uses a local OAuth setup and the Google Photos `append-only` flow, so it is designed for uploading grouped albums created through Media Organizer rather than reorganizing an existing Google Photos library or providing two-way sync.

## 🚀 Quick Start

Media Organizer runs on Windows, macOS, and Linux for source-based development and local use. The current ready-to-download packaged release is a Windows x64 portable `.exe`; native packaged releases for macOS and Linux are planned for future iterations.

For non-technical users on Windows, portable builds are published on the [Releases page](https://github.com/JosueArevalo/media-organizer/releases). Download the `Media-Organizer-*-windows-x64-portable.exe` file and open it directly; no installer, Node.js, npm, Git, or Python is required. Application data remains in `%APPDATA%\Media Organizer` when the executable is replaced.

Current Windows portable builds are unsigned, so Windows SmartScreen can display an **Unknown publisher** warning. Verify the downloaded file against `SHA256SUMS.txt` from the same release. Automatic updates are not enabled; download a newer executable manually when a new release is available.

MozJPEG, ImageMagick, ExifTool and HandBrakeCLI are intentionally not redistributed. Configure their executable paths from **Settings** when the corresponding processing feature is needed. The application can still start, select folders, inspect media and use safe copy paths when those optional tools are absent.

For source-based development, you need **Git**, **Node.js**, and **npm**. Media-processing tools can be installed afterwards when you need compression, conversion, or metadata support.

The repository is pinned to **Node.js `22.22.3`**. The supported minimum is `22.13.0`; Node 24 LTS is also supported.

```bash
git clone https://github.com/JosueArevalo/media-organizer.git
cd media-organizer
node -v
npm ci
npm run setup:check
npm run dev
```

Open:

- Dashboard: <http://localhost:5173>
- Backend health check: <http://localhost:4000/api/health>

Stop both development servers with `Ctrl+C` in the terminal running them.

> [!NOTE]
> The backend uses Node's built-in `node:sqlite` module. Node `22.9.0` is too old and will fail before the application starts. Always check the complete version with `node -v`.

## 🧰 Platform Setup

Choose the setup matching your operating system. These are tested paths, not the only possible ways to install the dependencies.

<details>
<summary><strong>🐧 Ubuntu — from a fresh installation</strong></summary>
<br>

Install the base packages used by Homebrew on Linux, plus Python for media-processing scripts:

```bash
sudo apt update
sudo apt install build-essential procps curl file git python3
```

Install [Homebrew on Linux](https://docs.brew.sh/Homebrew-on-Linux):

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

At the end of the installer, run the `brew shellenv` commands it prints. On a standard Linuxbrew installation they are:

```bash
echo 'eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"' >> ~/.bashrc
eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
```

Install the optional media tools:

```bash
brew install mozjpeg imagemagick exiftool handbrake
```

Install the pinned Node version with [`nvm`](https://github.com/nvm-sh/nvm):

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.5/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm install
nvm use
```

Then install and run the project:

```bash
git clone https://github.com/JosueArevalo/media-organizer.git
cd media-organizer
npm ci
npm run setup:check
npm run dev
```

Homebrew installs MozJPEG as keg-only. Media Organizer detects `cjpeg` under the Linuxbrew prefix, normally `/home/linuxbrew/.linuxbrew/opt/mozjpeg/bin/cjpeg`.

</details>

<details>
<summary><strong>🍎 macOS</strong></summary>
<br>

Install [Homebrew](https://brew.sh/) if it is not already available, then install Python and the media tools:

```bash
brew install python mozjpeg imagemagick exiftool handbrake
```

Install [`nvm`](https://github.com/nvm-sh/nvm), then use the Node version committed in `.nvmrc`:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.5/install.sh | bash
```

Close and reopen the terminal, then run:

```bash
git clone https://github.com/JosueArevalo/media-organizer.git
cd media-organizer
nvm install
nvm use
npm ci
npm run setup:check
npm run dev
```

MozJPEG is keg-only on macOS too. The application checks the common Homebrew prefixes for both Apple Silicon and Intel Macs.

</details>

<details>
<summary><strong>🪟 Windows PowerShell</strong></summary>
<br>

Install Node.js LTS and Git:

```powershell
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Git.Git -e
```

Install [Python 3](https://www.python.org/downloads/windows/), then clone and run the project from a new PowerShell window:

```powershell
git clone https://github.com/JosueArevalo/media-organizer.git
cd media-organizer
node -v
npm.cmd ci
npm.cmd run setup:check
npm.cmd run dev
```

Windows media tools are configured by executable path from **Settings** in the dashboard:

- [MozJPEG for Windows](https://github.com/garyzyg/mozjpeg-windows/releases) — select `cjpeg-static.exe`.
- [ImageMagick](https://imagemagick.org/script/download.php#windows) — select `magick.exe`.
- [ExifTool](https://exiftool.org/) — select `exiftool.exe`.
- [HandBrake CLI](https://handbrake.fr/downloads2.php) — select `HandBrakeCLI.exe`.

Use `npm.cmd` when PowerShell execution policy blocks the generated `npm.ps1` script.

</details>

## 🎛️ Media-processing tools

The dashboard can start without these tools. Install the ones required by the media operations you intend to run, then open **Settings → Encoder Tools** to verify that each executable is detected.

<details>
<summary><strong>What each tool is used for</strong></summary>
<br>

| Tool | Used for | Default command on macOS/Linux |
|---|---|---|
| [Python 3](https://www.python.org/downloads/) | Running the media processing and copy helper scripts. | `python3`, then `python` |
| [MozJPEG](https://formulae.brew.sh/formula/mozjpeg) | Compressing JPEG images. | `cjpeg` |
| [ImageMagick](https://imagemagick.org/) | Decoding and converting HEIC images before compression. | `magick` |
| [ExifTool](https://exiftool.org/) | Copying source metadata to processed images. | `exiftool` |
| [HandBrake CLI](https://handbrake.fr/downloads2.php) | Compressing video files with a selected preset. | `HandBrakeCLI` |

Missing encoders do not prevent you from opening the app, choosing folders, or reviewing media. Before a processing job starts, the UI reports unavailable tools and offers safe alternatives where supported.

</details>

## 🩺 Troubleshooting

<details>
<summary><strong>“Unsupported Node.js version” or the backend exits immediately</strong></summary>
<br>

Check the full version:

```bash
node -v
npm run setup:check
```

It must be `v22.13.0` or newer. If you use `nvm`, the repository already contains `.nvmrc` and `.node-version` pinned to `22.22.3`:

```bash
nvm install
nvm use
```

</details>

<details>
<summary><strong>A Homebrew tool is installed but reported as missing</strong></summary>
<br>

Confirm Homebrew is active in the current shell and inspect the executable:

```bash
eval "$(brew shellenv)"
brew --prefix
brew --prefix mozjpeg
```

Restart `npm run dev` after changing `PATH`. You can also save a specific executable path from the application Settings page.

</details>

<details>
<summary><strong>PowerShell blocks npm.ps1</strong></summary>
<br>

Use the Windows command shim without changing your execution policy:

```powershell
npm.cmd ci
npm.cmd run dev
```

</details>

<details>
<summary><strong>Dependency installation or audit warnings</strong></summary>
<br>

Use `npm ci` for a clean installation from the committed lockfile. Use `npm install` only when intentionally updating dependencies.

Do not run `npm audit fix --force` as part of normal setup. It can introduce major dependency changes unrelated to launching the application.

</details>

<details>
<summary><strong>Inspect detailed Grouping media traces</strong></summary>
<br>

Routine video range requests are quiet by default. To troubleshoot poster or playback streaming, set `MEDIA_ORGANIZER_MEDIA_TRACE=1` before starting the application:

```bash
MEDIA_ORGANIZER_MEDIA_TRACE=1 npm run dev
```

In PowerShell:

```powershell
$env:MEDIA_ORGANIZER_MEDIA_TRACE = '1'
npm.cmd run dev
```

</details>

## 🏗️ Architecture

Media Organizer is a TypeScript modular monolith with a deliberately simple flow:

```text
React dashboard
      ↓
Local Node.js API
      ↓
Pipeline and services
      ↓
SQLite · Filesystem · External media tools
```

| Area | Responsibility |
|---|---|
| `apps/web` | React dashboard, workflow UI, and API clients. |
| `apps/backend` | Local API, persisted state, pipeline orchestration, and filesystem access. |
| `scripts/` | Media-processing and verification helpers. |
| `docs/` | Product, architecture, state contract, and quality guidance. |

The core flow remains `Frontend → Backend → Pipeline → Filesystem / Tools`.

## 🧑‍💻 Development

<details>
<summary><strong>Common commands</strong></summary>
<br>

```bash
# Backend + frontend
npm run dev

# Individual applications
npm run dev:backend
npm run dev:web

# Production builds
npm run build

# Backend tests
npm test

# Frontend tests
npm run test --workspace apps/web
```

Recommended quality gate before merging:

```bash
npm run build
npm test
npm run test --workspace apps/web
```

On Windows PowerShell, replace `npm` with `npm.cmd` if script execution is restricted.

</details>

## 🔐 Security model

V1 is local-first and single-user:

- The backend is intended for localhost use, not LAN or internet exposure.
- Browser origins and Host headers are restricted to localhost-style addresses.
- CORS does not use a wildcard origin.
- Request bodies have a bounded size.
- Filesystem-mutating maintenance endpoints require explicit confirmation tokens.
- LAN access should not be enabled without first adding authentication or a local access token.

## 📚 Documentation

- [Product requirements](docs/PRD.md)
- [Architecture](docs/ARCHITECTURE.md)
- [V1 state and resume contract](docs/STATE_CONTRACT.md)
- [Quality, security, and dependency baseline](docs/QUALITY_BASELINE.md)
- [Guidance for AI agents](AGENTS.md)
- [Tool-agnostic AI context](AI_CONTEXT.md)
- [Contributing guide](CONTRIBUTING.md)
- [Citation metadata](CITATION.cff)

## 🚧 Project status

Media Organizer is an advanced local beta with a substantial end-to-end workflow already in place: import, review, compress, organize, export, resumable state, execution history, and cross-platform source-based setup are all part of the current project.

The current focus is no longer proving the basic MVP flow, but strengthening robustness, polish, packaging, and future iterations. Packaged releases are currently published as Windows x64 portable executables, while macOS and Linux remain fully supported for source-based development and local runs.

## 🤝 Contributing

Contributions are welcome. Please read the [contributing guide](CONTRIBUTING.md) before opening a pull request. Contributions are accepted under the same MIT License as the project, without a copyright assignment or Contributor License Agreement.

## 📄 License and citation

Media Organizer is available under the [MIT License](LICENSE).

Copyright (c) 2026 [Josue Arevalo](https://github.com/JosueArevalo).

If Media Organizer supports academic or research work, please cite it using the repository's [citation metadata](CITATION.cff). GitHub can generate a formatted citation from this file through the repository's **Cite this repository** action.
