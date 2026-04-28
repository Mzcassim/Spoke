/**
 * Demo Seed Script — Simulates a gala filling up in real time.
 * 
 * Run with the server already running:
 *   node demo_seed.js
 * 
 * Open /graph in a browser and watch it populate live.
 * Great for screen recordings.
 */

const BASE = process.env.BASE_URL || 'http://localhost:3000';

const NAMES = [
  // VC / Investor
  { name: 'Sarah Chen', email: 'sarah@sequoia.com', role: 'vc' },
  { name: 'Marcus Rivera', email: 'marcus@a16z.com', role: 'vc' },
  { name: 'Emily Zhang', email: 'emily@greylock.com', role: 'vc' },
  { name: 'David Kim', email: 'david@accel.com', role: 'vc' },
  { name: 'Rachel Okonkwo', email: 'rachel@benchmark.com', role: 'vc' },
  { name: 'James Morrison', email: 'james@lux.vc', role: 'vc' },
  { name: 'Anika Patel', email: 'anika@indexvc.com', role: 'vc' },
  { name: 'Thomas Wright', email: 'thomas@founders.fund', role: 'vc' },
  { name: 'Nina Kowalski', email: 'nina@lightspeed.com', role: 'vc' },
  { name: 'Omar Hassan', email: 'omar@general.catalyst', role: 'vc' },
  { name: 'Julia Fernandez', email: 'julia@bessemer.com', role: 'vc' },
  { name: 'Alex Nakamura', email: 'alex@ribbit.vc', role: 'vc' },

  // Founders
  { name: 'Priya Sharma', email: 'priya@startup.com', role: 'founder' },
  { name: 'Jordan Lee', email: 'jordan@ailab.io', role: 'founder' },
  { name: 'Sofia Martinez', email: 'sofia@fintech.co', role: 'founder' },
  { name: 'Leo Dubois', email: 'leo@robotics.dev', role: 'founder' },
  { name: 'Amara Osei', email: 'amara@healthtech.io', role: 'founder' },
  { name: 'Ryan Tanaka', email: 'ryan@devtools.com', role: 'founder' },
  { name: 'Zara Khan', email: 'zara@edtech.co', role: 'founder' },
  { name: 'Eli Bergman', email: 'eli@climate.tech', role: 'founder' },
  { name: 'Maya Johansson', email: 'maya@biotech.io', role: 'founder' },
  { name: 'Carlos Reyes', email: 'carlos@logistics.ai', role: 'founder' },
  { name: 'Isla McBride', email: 'isla@saas.dev', role: 'founder' },
  { name: 'Kai Watanabe', email: 'kai@quantum.io', role: 'founder' },
  { name: 'Nia Jackson', email: 'nia@marketplace.co', role: 'founder' },
  { name: 'Ravi Gupta', email: 'ravi@infra.cloud', role: 'founder' },

  // Club Members
  { name: 'Hannah Park', email: 'hannah@harvard.edu', role: 'member' },
  { name: 'Ben Okafor', email: 'ben@mit.edu', role: 'member' },
  { name: 'Lily Chung', email: 'lily@stanford.edu', role: 'member' },
  { name: 'Sam Adeyemi', email: 'sam@columbia.edu', role: 'member' },
  { name: 'Grace Liu', email: 'grace@yale.edu', role: 'member' },
  { name: 'Oscar Moreno', email: 'oscar@penn.edu', role: 'member' },
  { name: 'Chloe Nguyen', email: 'chloe@brown.edu', role: 'member' },
  { name: 'Ethan Brooks', email: 'ethan@dartmouth.edu', role: 'member' },
  { name: 'Mia Santos', email: 'mia@cornell.edu', role: 'member' },
  { name: 'Liam O\'Connor', email: 'liam@princeton.edu', role: 'member' },

  // Guest / Mentor
  { name: 'Diana Ross', email: 'diana@advisory.com', role: 'guest' },
  { name: 'Victor Huang', email: 'victor@mentor.org', role: 'guest' },
  { name: 'Fatima Al-Said', email: 'fatima@consulting.co', role: 'guest' },
  { name: 'Robert Kline', email: 'robert@board.io', role: 'guest' },
  { name: 'Yuki Sato', email: 'yuki@advisor.jp', role: 'guest' },
  { name: 'Ingrid Larsen', email: 'ingrid@nordic.vc', role: 'guest' },
  { name: 'Andre Williams', email: 'andre@operator.co', role: 'guest' },
  { name: 'Tara Mehta', email: 'tara@angellist.com', role: 'guest' },
];

const GUEST_COUNT = NAMES.length; // 46 guests

// --- Timing ---
const REG_DELAY_MIN = 600;   // ms between registrations
const REG_DELAY_MAX = 1500;
const CONN_DELAY_MIN = 700;
const CONN_DELAY_MAX = 1800;
const PAUSE_AFTER_REG = 3000; // pause between registration phase and connection phase

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function fetchRetry(url, opts, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, opts);
      return await res.json();
    } catch (err) {
      if (i === retries - 1) throw err;
      await sleep(500 * (i + 1));
    }
  }
}

async function registerGuest(wristbandId, guest) {
  return fetchRetry(`${BASE}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wristband_id: wristbandId,
      name: guest.name,
      email: guest.email,
      role: guest.role,
    }),
  });
}

async function connectGuests(fromId, toId) {
  return fetchRetry(`${BASE}/api/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from_id: fromId, to_id: toId }),
  });
}

async function run() {
  console.log('\n🎪  Spoke Demo Seeder');
  console.log(`    Server: ${BASE}`);
  console.log(`    Guests: ${GUEST_COUNT}`);
  console.log('    Open /graph in your browser and start recording!\n');

  await sleep(2000);

  // --- Phase 1: Register guests with staggered timing ---
  console.log('━━━ Phase 1: Guest check-in ━━━\n');

  const ids = [];
  for (let i = 0; i < GUEST_COUNT; i++) {
    const wristbandId = String(i + 1).padStart(3, '0');
    ids.push(wristbandId);
    const guest = NAMES[i];

    const result = await registerGuest(wristbandId, guest);
    if (result.success) {
      console.log(`  ✓ ${wristbandId}  ${guest.name} (${guest.role})`);
    } else {
      console.log(`  ✗ ${wristbandId}  ${guest.name} — ${result.error}`);
    }

    // Variable delay — faster at start (excited arrivals), slower in middle
    const progress = i / GUEST_COUNT;
    let delay;
    if (progress < 0.3) {
      delay = randInt(REG_DELAY_MIN, REG_DELAY_MIN + 300); // Fast initial wave
    } else if (progress < 0.7) {
      delay = randInt(REG_DELAY_MIN + 200, REG_DELAY_MAX); // Steady middle
    } else {
      delay = randInt(REG_DELAY_MIN, REG_DELAY_MIN + 500); // Late arrivals
    }
    await sleep(delay);
  }

  console.log(`\n  ✅ ${GUEST_COUNT} guests registered\n`);
  console.log('  ⏸  Pausing before connections begin...\n');
  await sleep(PAUSE_AFTER_REG);

  // --- Phase 2: Random connections ---
  console.log('━━━ Phase 2: Guests connecting ━━━\n');

  // Generate ~80 random connections
  const TARGET_CONNECTIONS = 80;
  const connectionSet = new Set();
  const connectionPairs = [];

  // Create some "hub" guests who connect with many people (realistic)
  const hubs = shuffle([...ids]).slice(0, 6);

  // Hub connections first (hubs meet lots of people)
  for (const hub of hubs) {
    const targets = shuffle(ids.filter(id => id !== hub)).slice(0, randInt(5, 10));
    for (const target of targets) {
      const key = [hub, target].sort().join('-');
      if (!connectionSet.has(key)) {
        connectionSet.add(key);
        connectionPairs.push([hub, target]);
      }
    }
  }

  // Random connections to fill up
  while (connectionPairs.length < TARGET_CONNECTIONS) {
    const a = ids[randInt(0, ids.length - 1)];
    const b = ids[randInt(0, ids.length - 1)];
    if (a === b) continue;
    const key = [a, b].sort().join('-');
    if (connectionSet.has(key)) continue;
    connectionSet.add(key);
    connectionPairs.push([a, b]);
  }

  // Shuffle for natural ordering
  shuffle(connectionPairs);

  let connCount = 0;
  for (const [fromId, toId] of connectionPairs) {
    const result = await connectGuests(fromId, toId);
    connCount++;
    if (result.success && !result.already_connected) {
      console.log(`  ⚡ ${result.from_name} ↔ ${result.to_name}`);
    }

    // Variable delay — bursts of connections then quiet moments
    let delay;
    if (Math.random() < 0.15) {
      delay = randInt(1800, 3000); // Occasional longer pause (people chatting)
    } else if (Math.random() < 0.3) {
      delay = randInt(300, 500);   // Quick burst (group introductions)
    } else {
      delay = randInt(CONN_DELAY_MIN, CONN_DELAY_MAX);
    }
    await sleep(delay);
  }

  console.log(`\n  ✅ ${connCount} connections made\n`);
  console.log('━━━ Demo complete ━━━\n');
  console.log('  The graph should now show a rich network.');
  console.log('  Press T to toggle theme, F for fullscreen.\n');
}

run().catch(console.error);
