// MIL sounds v3 - bulletproof via __dirname and exec
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

class SoundPlayer {
  constructor(log) {
    this.log = log;
    this.enabled = true;
    this.alertSound = null;
    this.softSound = null;
    this.loadSounds();
  }

  loadSounds() {
    // __dirname is src/main. Go up two levels to project root.
    const soundsDir = path.resolve(__dirname, '..', '..', 'resources', 'sounds');
    const alertPath = path.join(soundsDir, 'alert.wav');
    const softPath = path.join(soundsDir, 'soft.wav');
    
    this.alertSound = fs.existsSync(alertPath) ? alertPath : null;
    this.softSound = fs.existsSync(softPath) ? softPath : null;
    this.log.info(`Sounds loaded: alert=${!!this.alertSound}, soft=${!!this.softSound}`);
    if (this.alertSound) this.log.info(`Alert path: ${this.alertSound}`);
  }

  setEnabled(enabled) {
    this.enabled = enabled;
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
    
    this.log.info(`Playing sound: ${path.basename(file)}`);

    try {
      if (process.platform === 'win32') {
        const safe = file.replace(/'/g, "''");
        // Using exec and powershell.exe explicitly avoids spawn/detach issues
        const cmd = `powershell.exe -NoProfile -WindowStyle Hidden -Command "(New-Object System.Media.SoundPlayer '${safe}').PlaySync()"`;
        
        exec(cmd, { windowsHide: true }, (error, stdout, stderr) => {
          if (error) {
            this.log.warn(`Sound playback error: ${error.message}`);
          } else if (stderr) {
            this.log.warn(`Sound stderr: ${stderr}`);
          }
        });
      } else {
        const cmd = process.platform === 'darwin' ? 'afplay' : 'paplay';
        exec(`${cmd} "${file}"`, (error) => {
          if (error) this.log.warn(`Sound playback error: ${error.message}`);
        });
      }
    } catch (err) {
      this.log.warn(`Sound execution crashed: ${err.message}`);
    }
  }
}

module.exports = { SoundPlayer };