const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const DB_PATH = './static.db'; // Download this from RIFT repo
const OUTPUT_DIR = './resources/data';

if (!fs.existsSync(DB_PATH)) {
  console.error(`Error: ${DB_PATH} not found.`);
  console.log('Download it from: https://gitlab.com/rift-intel-fusion-tool/rift-intel-fusion-tool/-/blob/release/src/main/resources/static.db');
  process.exit(1);
}

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  // Extract ships
  db.all('SELECT typeId, name, class FROM Ships ORDER BY name', (err, ships) => {
    if (err) throw err;
    console.log(`Extracted ${ships.length} ships`);
    
    const shipNames = ships.map(s => s.name);
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'ships.json'),
      JSON.stringify(shipNames, null, 2)
    );
    
    // Extract systems and adjacency
    db.all('SELECT solarSystemId, solarSystemName FROM SolarSystems', (err, systems) => {
      if (err) throw err;
      console.log(`Extracted ${systems.length} solar systems`);
      
      const idToName = {};
      systems.forEach(s => { idToName[s.solarSystemId] = s.solarSystemName; });
      
      db.all('SELECT fromSystemId, toSystemId FROM StarGates', (err, gates) => {
        if (err) throw err;
        console.log(`Extracted ${gates.length} gate connections`);
        
        const adjacency = {};
        gates.forEach(g => {
          const from = idToName[g.fromSystemId];
          const to = idToName[g.toSystemId];
          if (from && to) {
            if (!adjacency[from]) adjacency[from] = [];
            if (!adjacency[from].includes(to)) adjacency[from].push(to);
          }
        });
        
        // Sort neighbor lists
        Object.keys(adjacency).forEach(sys => {
          adjacency[sys].sort();
        });
        
        fs.writeFileSync(
          path.join(OUTPUT_DIR, 'systems.json'),
          JSON.stringify({ systems: adjacency }, null, 2)
        );
        
        console.log(`\nSaved to ${OUTPUT_DIR}/:`);
        console.log(`  ships.json (${shipNames.length} ships)`);
        console.log(`  systems.json (${Object.keys(adjacency).length} systems with adjacency)`);
        
        db.close();
      });
    });
  });
});