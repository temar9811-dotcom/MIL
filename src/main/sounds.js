// MIL sounds v5 - packaged-aware sound paths
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

class SoundPlayer {
  constructor(log) {
    this.log = log;
    this.enabled = true;
    this.volume = 50;
    this.alertSound = null;
    this.softSound = null;
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
    this.alertSound = fs.existsSync(alertPath) ? alertPath : null;
    this.softSound = fs.existsSync(softPath) ? softPath : null;
    this.log.info(`Sounds loaded: alert=${!!this.alertSound}, soft=${!!this.softSound} (${dir})`);
  }

  setEnabled(enabled) { this.enabled = enabled; }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(100, Number(v) || 0));
    this.log.info(`Alert volume set to ${this.volume}%`);
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
    const file = type === 'red' ? this.alertSound : this.softSound;
    if (!file) {
      this.log.warn(`No sound file for type: ${type}`);
      return;
    }
    if (this.volume <= 0) {
      this.log.info(`Sound skipped (volume 0): ${type}`);
      return;
    }

    this.log.info(`Playing sound: ${path.basename(file)} at ${this.volume}%`);
    const vol = (this.volume / 100).toFixed(2);

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