// test-sound.js - standalone sound diagnostic
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const alertPath = path.join(__dirname, 'resources', 'sounds', 'alert.wav');
const softPath = path.join(__dirname, 'resources', 'sounds', 'soft.wav');

console.log('=== SOUND DIAGNOSTIC ===\n');
console.log('alert.wav exists:', fs.existsSync(alertPath));
console.log('soft.wav exists:', fs.existsSync(softPath));

if (!fs.existsSync(alertPath)) {
  console.log('\n❌ alert.wav NOT FOUND at:', alertPath);
  process.exit(1);
}

const stat = fs.statSync(alertPath);
console.log('alert.wav size:', stat.size, 'bytes');

console.log('\n=== TESTING POWERSHELL PLAYBACK ===\n');
console.log('Attempting to play alert.wav via PowerShell...');
console.log('(You should hear sound in the next 3 seconds)\n');

const safe = alertPath.replace(/'/g, "''");
const cmd = `(New-Object System.Media.SoundPlayer '${safe}').PlaySync()`;

const child = spawn('powershell', [
  '-NoProfile',
  '-WindowStyle', 'Hidden',
  '-Command', cmd
], {
  stdio: 'inherit'
});

child.on('exit', (code) => {
  console.log('\n✓ PowerShell exited with code:', code);
  if (code === 0) {
    console.log('✓ If you heard sound, your system CAN play it');
    console.log('✓ The issue is in how the app calls the sound player');
  } else {
    console.log('❌ PowerShell failed - check if alert.wav is a valid WAV file');
  }
});

child.on('error', (err) => {
  console.log('\n❌ Failed to spawn PowerShell:', err.message);
});