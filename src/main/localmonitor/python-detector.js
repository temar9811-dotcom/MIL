// # FILE: src/main/localmonitor/python-detector.js
// # VERSION: 1
// Manages the Python detector subprocess for region capture + OpenCV matching.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

class PythonDetector {
  constructor(log) {
    this.log = log;
    this.proc = null;
    this.pending = new Map();
    this.nextId = 1;
    this.ready = false;
    this.templatesLoaded = false;
    this.templateData = null;
    this.threshold = 0.6;
    this.buffer = '';
  }

  // Start the Python subprocess
  async start(templatesDir, threshold = 0.6, scale = 'all') {
    if (this.proc && this.ready && this.templatesLoaded) return;
    this.threshold = threshold;
    this.scale = scale;
    this.templateData = await this.loadTemplateData(templatesDir);

    const packagedDetectors = [
      path.join(process.resourcesPath || '', 'local-monitor', 'runtime', 'detector.exe'),
      path.join(process.resourcesPath || '', 'resources', 'local-monitor', 'runtime', 'detector.exe'),
    ];
    const devScript = path.join(__dirname, '..', '..', '..', 'resources', 'local-monitor', 'python', 'detector.py');
    let command;
    let args;
    if (app.isPackaged) {
      command = packagedDetectors.find((candidate) => fs.existsSync(candidate));
      if (!command) {
        throw new Error('Bundled Local Monitor detector is missing. Reinstall the application.');
      }
      args = [];
    } else {
      if (!fs.existsSync(devScript)) {
        throw new Error('Python detector script is missing from the source checkout');
      }
      command = this.findPython();
      args = [devScript];
      if (!command) {
        throw new Error('Python not found. Install Python 3.9+ with opencv-python, numpy, and mss to run from source.');
      }
    }

    this.log.info(`[PythonDetector] Starting: ${command}${args.length ? ` ${args.join(' ')}` : ''}`);
    this.proc = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    });

    this.proc.stdout.on('data', (data) => this.handleStdout(data));
    this.proc.stderr.on('data', (data) => this.log.warn(`[PythonDetector] stderr: ${data.toString()}`));
    this.proc.on('exit', (code) => this.handleExit(code));
    this.proc.on('error', (err) => this.log.error(`[PythonDetector] spawn error: ${err.message}`));

    // Wait for process to be ready, then load templates
    await this.waitForReady();
    await this.sendTemplates();
    this.ready = true;
    this.log.info('[PythonDetector] Ready');
  }

  findPython() {
    const candidates = [
      'python3',
      'python',
      'py',
      path.join(process.execPath, '..', 'python.exe'), // Bundled python if any
    ];
    for (const cmd of candidates) {
      try {
        const { spawnSync } = require('child_process');
        const result = spawnSync(cmd, ['-c', 'import cv2, numpy, mss; print("ok")'], { timeout: 5000 });
        if (result.status === 0) return cmd;
      } catch (_) {}
    }
    return null;
  }

  async loadTemplateData(templatesDir) {
    const templates = [];
    try {
      const entries = fs.readdirSync(templatesDir);
      for (const entry of entries.sort()) {
        const ext = path.extname(entry).toLowerCase();
        if (!['.png', '.jpg', '.jpeg', '.bmp'].includes(ext)) continue;
        if (!entry.toLowerCase().startsWith('image_')) continue;
        const match = path.basename(entry, ext).match(/_(\d{2,3})$/);
        const declaredScale = match ? Number(match[1]) : 100;

        const filePath = path.join(templatesDir, entry);
        const imgBuffer = fs.readFileSync(filePath);
        const base64 = imgBuffer.toString('base64');

        // Get dimensions using a quick decode (we could also use sharp or similar)
        // For now, we'll let Python decode and get dimensions
        templates.push({
          name: entry,
          data: base64,
          scale: declaredScale
        });
      }
    } catch (e) {
      this.log.warn(`[PythonDetector] Failed to load templates: ${e.message}`);
    }
    return templates;
  }

  waitForReady() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Python detector startup timeout')), 15000);
      const checkReady = () => {
        if (this.ready) {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(checkReady, 50);
        }
      };
      checkReady();
    });
  }

  async sendTemplates() {
    if (!this.templateData.length) {
      this.log.warn('[PythonDetector] No templates to send');
      return;
    }
    const result = await this.sendCommand('load_templates', {
      templates: this.templateData,
      threshold: this.threshold,
      scale: String(this.scale),
    });
    this.templatesLoaded = result.templates_loaded > 0;
    this.log.info(`[PythonDetector] Loaded ${result.templates_loaded} templates`);
  }

  async updateSettings(threshold, scale) {
    this.threshold = threshold;
    this.scale = scale;
    if (!this.ready || !this.proc) return;
    const result = await this.sendCommand('load_templates', {
      templates: this.templateData || [],
      threshold: this.threshold,
      scale: String(this.scale),
    });
    this.templatesLoaded = result.templates_loaded > 0;
  }

  handleStdout(data) {
    this.buffer += data.toString();
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        const id = msg.request_id;
        if (id && this.pending.has(id)) {
          const { resolve, reject, timer } = this.pending.get(id);
          clearTimeout(timer);
          this.pending.delete(id);
          if (msg.status === 'ok') resolve(msg);
          else reject(new Error(msg.message || 'Python detector error'));
        } else if (msg.ready || msg.pong) this.ready = true;
      } catch (e) {
        this.log.warn(`[PythonDetector] Failed to parse: ${line}`);
      }
    }
  }

  handleExit(code) {
    this.log.warn(`[PythonDetector] Process exited with code ${code}`);
    this.ready = false;
    this.templatesLoaded = false;
    // Reject all pending
    for (const [, { reject }] of this.pending) {
      reject(new Error('Python detector process exited'));
    }
    this.pending.clear();
  }

  sendCommand(cmd, payload) {
    return new Promise((resolve, reject) => {
      if (!this.proc || this.proc.killed) {
        reject(new Error('Python detector not running'));
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        const pending = this.pending.get(id);
        if (pending) {
          this.pending.delete(id);
          pending.reject(new Error('Python detector command timeout'));
        }
      }, 10000);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      const msg = JSON.stringify({ request_id: id, cmd, ...payload }) + '\n';
      this.proc.stdin.write(msg, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  async detect(region) {
    if (!this.ready || !this.templatesLoaded) {
      return { matches: [], error: 'Detector not ready' };
    }
    try {
      const result = await this.sendCommand('detect', { region });
      return { matches: result.matches || [], error: null };
    } catch (e) {
      this.log.error(`[PythonDetector] Detect failed: ${e.message}`);
      return { matches: [], error: e.message };
    }
  }

  async stop() {
    const proc = this.proc;
    this.proc = null;
    this.ready = false;
    this.templatesLoaded = false;
    if (proc && !proc.killed) proc.kill();
  }

  isReady() {
    return this.ready && this.templatesLoaded;
  }
}

module.exports = { PythonDetector };
