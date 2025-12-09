/**
 * Dummy GPS Data Generator
 * 
 * Simulates real GPS updates for testing when actual GPS devices are not available.
 * Generates realistic bus movement patterns with varying speeds, stops, and routes.
 */

// Kigali, Rwanda area coordinates for realistic testing
const KIGALI_CENTER = { lat: -1.9441, lon: 30.0619 };
const DEFAULT_DESTINATION = { lat: -1.9683524, lon: 30.0890925 };

/**
 * Haversine distance calculation
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const lat1Rad = toRad(lat1);
  const lat2Rad = toRad(lat2);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1Rad) * Math.cos(lat2Rad) *
            Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // meters
}

/**
 * Generate dummy GPS data for testing
 * 
 * @param {Object} options - Configuration options
 * @param {number} options.busCount - Number of buses to generate (default: 3)
 * @param {number} options.updateInterval - Update interval in seconds (default: 60)
 * @returns {Array} Array of device objects matching backend API format
 */
export function generateDummyGPSData(options = {}) {
  const {
    busCount = 3,
    updateInterval = 10, // 10 seconds for faster testing (can be set to 60 for realistic)
    destination = DEFAULT_DESTINATION, // Destination for ETA calculation
  } = options;

  const devices = [];
  const now = new Date();

  // Predefined bus routes (circular paths around Kigali)
  // Routes start FAR from destination to ensure realistic ETA (10-20 minutes)
  const routes = [
    // Route 1: North route - starts ~10km north of destination
    {
      start: { lat: -1.8800, lon: 30.0500 }, // Far north
      end: { lat: -1.9700, lon: 30.0700 },
      plateNumber: 'RAA 123A',
    },
    // Route 2: East route - starts ~10km east of destination
    {
      start: { lat: -1.9500, lon: 29.9800 }, // Far east
      end: { lat: -1.9400, lon: 30.0900 },
      plateNumber: 'RAA 456B',
    },
    // Route 3: Northeast route - starts ~10km northeast of destination
    {
      start: { lat: -1.9000, lon: 30.0000 }, // Far northeast
      end: { lat: -1.9600, lon: 30.0800 },
      plateNumber: 'RAA 789C',
    },
  ];

  // Initialize or get bus state from global store
  if (!global.dummyBusStates) {
    global.dummyBusStates = new Map();
  }

  for (let i = 0; i < busCount; i++) {
    const deviceId = `BUS${String(i + 1).padStart(3, '0')}`;
    const route = routes[i % routes.length];
    
    // Get or initialize bus state
    if (!global.dummyBusStates.has(deviceId)) {
      // Initialize bus at start of route - START MOVING IMMEDIATELY
      global.dummyBusStates.set(deviceId, {
        currentLat: route.start.lat,
        currentLon: route.start.lon,
        targetLat: route.end.lat,
        targetLon: route.end.lon,
        progress: 0, // 0 = start, 1 = end
        speed: 40, // km/h - start with higher speed for faster movement
        isMoving: true, // Start moving immediately
        lastUpdate: now,
        direction: 1, // 1 = going to end, -1 = returning to start
        stopTime: 0, // Time spent stopped (seconds)
        plateNumber: route.plateNumber,
      });
    }

    const state = global.dummyBusStates.get(deviceId);
    let timeSinceLastUpdate = (now - state.lastUpdate) / 1000; // seconds
    
    // Ensure minimum time delta (handle first update or clock issues)
    if (timeSinceLastUpdate <= 0 || timeSinceLastUpdate > updateInterval * 2) {
      timeSinceLastUpdate = updateInterval; // Use expected interval
    }

  // Update bus position and state
  updateBusState(state, timeSinceLastUpdate, updateInterval);

  // Calculate current position based on progress (linear interpolation)
  const currentLat = state.currentLat + (state.targetLat - state.currentLat) * state.progress;
  const currentLon = state.currentLon + (state.targetLon - state.currentLon) * state.progress;

    // Add some realistic GPS noise (±5 meters)
    const noise = () => (Math.random() - 0.5) * 0.00005; // ~5 meters
    const noisyLat = currentLat + noise();
    const noisyLon = currentLon + noise();

    // Backend only sends lat/lon - ETA will be calculated by server using Google Distance Matrix API
    devices.push({
      device_id: deviceId,
      plate_number: state.plateNumber,
      last_lat: noisyLat,
      last_lon: noisyLon,
      last_speed: state.speed,
      last_update: now.toISOString(),
      // ETA will be calculated by server using Google Distance Matrix API
    });

    // Update state for next iteration
    state.lastUpdate = now;
    global.dummyBusStates.set(deviceId, state);
  }

  return devices;
}

/**
 * Update bus state (position, speed, stops)
 * 
 * @param {Object} state - Bus state object
 * @param {number} timeSinceLastUpdate - Time since last update in seconds
 * @param {number} updateInterval - Expected update interval in seconds
 */
function updateBusState(state, timeSinceLastUpdate, updateInterval) {
  const MAX_SPEED = 80; // km/h (increased for faster movement)
  const MIN_SPEED = 0;
  const ACCELERATION = 40; // km/h per 10 seconds (faster acceleration)
  const DECELERATION = 35; // km/h per 10 seconds
  const STOP_PROBABILITY = 0.02; // 2% chance of stopping (reduced for more continuous movement)
  const STOP_DURATION = 10; // seconds (shorter stops)

  // Handle bus stops
  if (state.isMoving === false && state.stopTime > 0) {
    state.stopTime -= timeSinceLastUpdate;
    if (state.stopTime <= 0) {
      state.isMoving = true;
      state.speed = 10; // Start moving with some speed
    }
    return;
  }

  // Randomly decide to stop (simulate bus stops, traffic lights, etc.)
  // Only stop occasionally, not too often
  if (state.isMoving && state.speed > 5 && Math.random() < STOP_PROBABILITY) {
    state.isMoving = false;
    state.stopTime = STOP_DURATION + Math.random() * 10; // 15-25 seconds
    state.speed = 0;
    return;
  }

  // Update speed (accelerate/decelerate realistically)
  if (state.isMoving) {
    // Gradually increase speed if below max
    if (state.speed < MAX_SPEED) {
      state.speed = Math.min(
        MAX_SPEED,
        state.speed + (ACCELERATION * timeSinceLastUpdate) / 10
      );
    }
  } else {
    // Decelerate when stopping
    state.speed = Math.max(MIN_SPEED, state.speed - (DECELERATION * timeSinceLastUpdate) / 10);
  }

  // Update position progress
  if (state.isMoving && state.speed > 0) {
    // Calculate distance moved based on speed
    // Speed in km/h, convert to meters per second
    const speedMs = state.speed / 3.6; // m/s
    const distanceMoved = speedMs * timeSinceLastUpdate; // meters
    
    // Calculate total route distance using Haversine formula (more accurate)
    // 1 degree latitude ≈ 111 km, 1 degree longitude ≈ 111 km * cos(latitude)
    const latMid = (state.currentLat + state.targetLat) / 2;
    const latDistance = Math.abs(state.targetLat - state.currentLat) * 111000; // meters
    const lonDistance = Math.abs(state.targetLon - state.currentLon) * 111000 * Math.cos(latMid * Math.PI / 180); // meters
    const routeDistance = Math.sqrt(latDistance ** 2 + lonDistance ** 2); // meters
    
    // Update progress based on distance moved
    if (routeDistance > 0) {
      const progressIncrement = (distanceMoved / routeDistance) * state.direction;
      state.progress = Math.max(0, Math.min(1, state.progress + progressIncrement));
      
      // Debug: log if bus is actually moving
      if (progressIncrement > 0.001) {
        // Bus is moving significantly
      }
    }

    // If reached end, restart from beginning (circular route)
    if (state.progress >= 1) {
      // Reset to start of route - bus completes journey and restarts
      state.progress = 0;
      state.speed = 40; // Reset speed (higher for faster movement)
      state.isMoving = true;
      state.direction = 1; // Always go forward
      // Bus restarts at beginning of route
      console.log(`[Dummy GPS] Bus ${state.plateNumber || 'unknown'} completed journey, restarting...`);
    } else if (state.progress <= 0 && state.direction === -1) {
      // Reset to start
      state.progress = 0;
      state.direction = 1; // Always go forward
      state.speed = 40; // Higher speed
      state.isMoving = true;
    }
  }
}

/**
 * Reset all dummy bus states (useful for testing)
 */
export function resetDummyBusStates() {
  if (global.dummyBusStates) {
    global.dummyBusStates.clear();
  }
}

