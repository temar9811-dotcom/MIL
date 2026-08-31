// MIL sounds v7 - per-type volume + custom wav paths
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

// Master attenuation applied on top of each slider (0.7 = 30% quieter).
const MASTER_GAIN = 0.7;

class SoundPlayer {
  constructor(log) {
    this.log = log;
    this.enabled = true;
    this.volumeRed = 50;
    this.volumeSoft = 50;
    this.customAlert = null;
    this.customSoft = null;
    this.builtinAlert = null;
    this.builtinSoft = null;
    this.loadSounds();
  }

  soundsDir() {
    const base = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..', '..');
    return path.join(base, 'resources', 'sounds');
  }

  loadSounds() {
    const dir = this.soundsDir();
    const alertPath = path.join(dir, 'alert.wav');
    const softPath = path.join(dir, 'soft.wav');
    this.builtinAlert = fs.existsSync(alertPath) ? alertPath : null;
    this.builtinSoft = fs.existsSync(softPath) ? softPath : null;
    this.log.info(`Sounds loaded: alert=${!!this.builtinAlert}, soft=${!!this.builtinSoft} (${dir})`);
  }

  setEnabled(enabled) { this.enabled = enabled; }

  setVolumes(red, soft) {
    this.volumeRed = Math.max(0, Math.min(100, Number(red) || 0));
    this.volumeSoft = Math.max(0, Math.min(100, Number(soft) || 0));
    this.log.info(
      `Volumes: red=${this.volumeRed}% soft=${this.volumeSoft}% ` +
      `(effective ${Math.round(this.volumeRed * MASTER_GAIN)}/${Math.round(this.volumeSoft * MASTER_GAIN)}%)`,
    );
  }

  setCustomPaths(alertPath, softPath) {
    this.customAlert = alertPath && fs.existsSync(alertPath) ? alertPath : null;
    this.customSoft = softPath && fs.existsSync(softPath) ? softPath : null;
    if (alertPath && !this.customAlert) this.log.warn(`Custom alert wav not found: ${alertPath}`);
    if (softPath && !this.customSoft) this.log.warn(`Custom soft wav not found: ${softPath}`);
    this.log.info(`Custom sounds: alert=${this.customAlert || 'built-in'}, soft=${this.customSoft || 'built-in'}`);
  }

  fileFor(type) {
    return type === 'red'
      ? (this.customAlert || this.builtinAlert)
      : (this.customSoft || this.builtinSoft);
  }

  volumeFor(type) {
    return type === 'red' ? this.volumeRed : this.volumeSoft;
  }

  mediaPlayerCmd(file, vol) {
    const safe = file.replace(/'/g, "''");
    return [
      'Add-Type -AssemblyName PresentationCore;',
      `$mp = New-Object System.Windows.Media.MediaPlayer;`,
      `$mp.Open([Uri]::new('${safe}'));`,
      `$mp.Volume = ${vol};`,
      `$sw = [System.Diagnostics.Stopwatch]::StartNew();`,
      `while (-not $mp.NaturalDuration.HasTimeSpan -and $sw.ElapsedMilliseconds -lt 2000) { Start-Sleep -Milliseconds 50 };`,
      `$secs = 2;`,
      `if ($mp.NaturalDuration.HasTimeSpan) { $secs = [Math]::Ceiling($mp.NaturalDuration.TimeSpan.TotalSeconds) };`,
      `$mp.Play();`,
      `Start-Sleep -Seconds ($secs + 1);`,
      `$mp.Close()`,
    ].join(' ');
  }

  fallbackCmd(file) {
    const safe = file.replace(/'/g, "''");
    return `(New-Object System.Media.SoundPlayer '${safe}').PlaySync()`;
  }

  play(type) {
    if (!this.enabled) {
      this.log.info(`Sound skipped (disabled in settings): ${type}`);
      return;
    }
    const file = this.fileFor(type);
    if (!file) {
      this.log.warn(`No sound file for type: ${type}`);
      return;
    }
    const slider = this.volumeFor(type);
    if (slider <= 0) {
      this.log.info(`Sound skipped (volume 0): ${type}`);
      return;
    }

    const effective = Math.round(slider * MASTER_GAIN);
    this.log.info(`Playing ${type} sound: ${path.basename(file)} at ${slider}% (${effective}% effective)`);
    const vol = ((slider / 100) * MASTER_GAIN).toFixed(2);

    try {
      const cmd = `powershell.exe -NoProfile -WindowStyle Hidden -Command "${this.mediaPlayerCmd(file, vol)}"`;
      exec(cmd, { windowsHide: true }, (error) => {
        if (error) {
          this.log.warn(`MediaPlayer failed (${error.message}); falling back to SoundPlayer`);
          const fb = `powershell.exe -NoProfile -WindowStyle Hidden -Command "${this.fallbackCmd(file)}"`;
          exec(fb, { windowsHide: true }, () => {});
        }
      });
    } catch (err) {
      this.log.warn(`Sound execution crashed: ${err.message}`);
    }
  }
}

module.exports = { SoundPlayer };