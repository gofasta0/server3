// Load environment variables from .env file FIRST
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname for .env file path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file from server directory
const result = dotenv.config({ path: path.join(__dirname, '.env') });

if (result.error) {
    console.error('[dotenv] Error loading .env file:', result.error);
} else {
    console.log('[dotenv] Loaded .env file successfully');
}

import axios from 'axios';
import cors from 'cors';
import { Expo } from 'expo-server-sdk';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

// --- UTILITY IMPORTS (ASSUMED) ---
import { generateDummyGPSData } from './utils/dummyGPS.js';
import { getETAFromGoogle, getRouteFromGoogle } from './utils/googleMaps.js';
// NOTE: Ensure handleNotifications is defined globally for use in broadcastLiveDevices

// --- APP SETUP ---
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));


// --- ENVIRONMENT VARIABLES AND CONSTANTS ---
const DEVICE_API_URL = process.env.DEVICE_API_URL || 'https://gofasta.onrender.com/api/devices';
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 10000); 
const USE_DUMMY_GPS = process.env.USE_DUMMY_GPS === 'true' || process.env.USE_DUMMY_GPS === '1';
const DUMMY_BUS_COUNT = Number(process.env.DUMMY_BUS_COUNT || 3);
const DUMMY_UPDATE_INTERVAL = Number(process.env.DUMMY_UPDATE_INTERVAL || 10);
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

// --- GLOBAL STATE DECLARATIONS ---
let googleApiCallCount = { distanceMatrix: 0, directions: 0 };
let lastApiCallReset = Date.now();

let latestDevices = [];
let lastFetchedAt = null;
let lastFetchError = null;
const notificationSubscriptions = new Map();

// Cache for Google API results 
const googleApiCache = new Map(); 


// --- CACHE AND DWELL TIME SETTINGS (FIXED FOR REALISM) ---
const GOOGLE_ETA_CACHE_MS = Number(process.env.GOOGLE_ETA_CACHE_MS || 60 * 1000); // 60 seconds
const GOOGLE_ROUTE_CACHE_MS = Number(process.env.GOOGLE_ROUTE_CACHE_MS || 6 * 60 * 60 * 1000); // 6 hours
const MIN_DISTANCE_FOR_ETA_REFRESH = Number(process.env.MIN_DISTANCE_FOR_ETA_REFRESH || 100); // 100 meters
const DWELL_TIME_PER_STOP = 30; // seconds
// CRITICAL FIX: Time limit for considering a device OFF
const STALE_DATA_LIMIT_MS = Number(process.env.STALE_DATA_LIMIT_MS || 10 * 60 * 1000); // 10 minutes

const DEFAULT_DESTINATION = { lat: -1.9683524, lon: 30.0890925 };

const expo = new Expo();


// --- UTILITY FUNCTIONS ---

const secondsToMinutes = (etaSeconds = 0) => {
    if (!etaSeconds || Number.isNaN(etaSeconds) || etaSeconds <= 0) return 0;
    const minutes = Number(etaSeconds) / 60;
    return Math.round(minutes);
};

const normalizeCoordinate = (value) => {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
};

const getDistanceInMeters = (lat1, lon1, lat2, lon2) => {
    const R = 6371000; 
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

const getRemainingStops = (routeId, currentPosition, destination) => {
    return process.env.MOTO_STOP_COUNT; 
}

const getOccupancy = () => {
    return Math.floor(Math.random() * 30) + 50; 
};

const getEtaStatus = (currentEta, previousEta, isMoving, distanceMoved) => {
    if (!isMoving && distanceMoved < 10) { 
        return { status: 'stopped', message: 'Bus is stopped' };
    }
    
    if (previousEta === null || previousEta === undefined) {
        return { status: 'normal', message: 'Starting trip' };
    }
    
    const etaChange = currentEta - previousEta;
    
    if (etaChange > 120) { 
        return { status: 'traffic', message: 'Heavy traffic ahead' };
    } else if (etaChange < -60) { 
        return { status: 'faster', message: 'Moving faster than expected' };
    } else {
        return { status: 'normal', message: 'Normal traffic' };
    }
};

// --- CORE MAPPING FUNCTION (FIXED LOGIC) ---

const mapDeviceToSocketPayload = async (device, destination = DEFAULT_DESTINATION) => {
    const busId = device.device_id || device.id;
    const lat = normalizeCoordinate(device.last_lat);
    const lng = normalizeCoordinate(device.last_lon);

    if (lat == null || lng == null) {
        console.log(`[Bus ${busId}] ⚠️ Skipping update: Missing GPS coordinates.`);
        return null;
    }

    const currentPosition = { lat, lng };
    const rawSpeed = Number(device.last_speed) || 0;
    const isMoving = rawSpeed > 0.5;

    let googleETA = null;
    let googleRoute = null;
    let finalETASeconds = 0;
    
    const cacheKey = `${busId}_${destination.lat}_${destination.lon}`;
    const cached = googleApiCache.get(cacheKey) || {};
    const now = Date.now();

    // --- FIX 1: STALE DATA / OFFLINE CHECK ---
    const lastUpdateTimestamp = new Date(device.last_update).getTime();
    const isStaleOrOffline = (now - lastUpdateTimestamp) > STALE_DATA_LIMIT_MS;

    if (isStaleOrOffline) {
        console.warn(`[Bus ${busId}] 🔴 Device Offline/Stale. Last update: ${new Date(lastUpdateTimestamp).toLocaleTimeString()}. Skipping ETA calculation.`);
        return {
            busId: busId,
            plateNumber: device.plate_number || `Bus ${busId}`,
            currentPosition: currentPosition,
            occupancyRate: getOccupancy(),
            eta: null,
            etaSeconds: 0,
            isMoving: false,
            speed: 0,
            lastUpdate: device.last_update,
            timestamp: now,
            etaStatus: 'offline',
            etaMessage: `Offline. Last data ${secondsToMinutes((now - lastUpdateTimestamp) / 1000)} min ago.`,
        };
    }
    // ----------------------------------------

    let distanceMoved = 0;
    if (cached.lastPosition) {
        distanceMoved = getDistanceInMeters(
            cached.lastPosition.lat,
            cached.lastPosition.lng,
            lat,
            lng
        );
    }
    
    let etaStatus = getEtaStatus(cached.eta, cached.lastEta, isMoving, distanceMoved);

    // --- ETA Refresh Logic ---
    const cacheExpired = !cached.etaLastUpdate || (now - cached.etaLastUpdate) > GOOGLE_ETA_CACHE_MS;
    const movedSignificantly = distanceMoved > MIN_DISTANCE_FOR_ETA_REFRESH;
    
    let shouldRefreshEta = cacheExpired || movedSignificantly;
    
    // If bus is stopped and hasn't moved, only refresh if the cache is super stale (2x normal time)
    if (!isMoving && distanceMoved < 50) {
        if (cached.etaLastUpdate && (now - cached.etaLastUpdate) < GOOGLE_ETA_CACHE_MS * 2) {
            shouldRefreshEta = false; 
        }
    }
    
    const shouldRefreshRoute =
        !cached.routeLastUpdate || (now - cached.routeLastUpdate) > GOOGLE_ROUTE_CACHE_MS;

    // --- LOG API DECISION ---
    if (shouldRefreshEta || shouldRefreshRoute) {
        console.log(`[Bus ${busId}] 🎯 API DECISION: REFRESHING DATA.`);
        console.log(`    > ETA Refresh: ${shouldRefreshEta} (Cache Expired: ${cacheExpired}, Moved: ${distanceMoved.toFixed(0)}m)`);
    } else {
        // --- CACHE HIT LOGIC (FIXED: Stop adjustment if bus is stopped) ---
        if (typeof cached.eta === 'number' && cached.etaLastUpdate) {
            
            if (isMoving) {
                // FIX 2A: Apply time adjustment ONLY if the bus IS MOVING
                const timeElapsed = (now - cached.etaLastUpdate) / 1000;
                const adjustedETA = Math.max(0, cached.eta - timeElapsed); 
                
                console.log(`[Bus ${busId}] ✅ CACHE HIT: Adjusted ETA from ${secondsToMinutes(cached.eta)} min to ${secondsToMinutes(adjustedETA)} min (Time elapsed: ${timeElapsed.toFixed(0)}s).`);
                
                googleETA = adjustedETA;
                
            } else {
                // FIX 2B: If the bus is NOT MOVING, use the cached ETA without adjustment.
                console.log(`[Bus ${busId}] ✅ CACHE HIT: Bus stopped. Using cached ETA ${secondsToMinutes(cached.eta)} min without adjustment. Stops ETA decrease.`);
                googleETA = cached.eta;
            }
        } else {
            console.log(`[Bus ${busId}] ✅ API DECISION: CACHE HIT. Speed: ${rawSpeed.toFixed(1)} km/h`);
            googleETA = cached.eta;
        }
    }
    // ---------------------------------
    
    // Start with whatever is currently cached if refresh is skipped
    if (!shouldRefreshEta && typeof cached.eta === 'number') {
        // googleETA is already set and adjusted in the block above
    }
    if (!shouldRefreshRoute && Array.isArray(cached.route)) {
        googleRoute = cached.route;
    }

    const updatedCache = { ...cached };

    // --- GOOGLE API CALLS ---
    if (shouldRefreshEta || shouldRefreshRoute) {
        try {
            if (shouldRefreshEta) { 
                googleApiCallCount.distanceMatrix++;
                
                // --- LOG API INPUT ---
                console.log(`[Bus ${busId}] ➡️ GOOGLE INPUT (ETA): Start(${lat.toFixed(4)}, ${lng.toFixed(4)}) -> End(${destination.lat}, ${destination.lon})`);
                // ---------------------

                const etaResult = await getETAFromGoogle(
                    lat,
                    lng,
                    destination.lat,
                    destination.lon
                );
                const newEta = etaResult.duration; 

                // --- LOG API OUTPUT ---
                console.log(`[Bus ${busId}] ⬅️ GOOGLE OUTPUT (ETA): ${newEta} seconds. Status: ${etaResult.status}`);
                // ----------------------

                updatedCache.lastEta = cached.eta; 
                updatedCache.eta = newEta; 
                googleETA = newEta; // Use the fresh data

                updatedCache.etaLastUpdate = now; // Update timestamp only on fresh data
                
                etaStatus = getEtaStatus(googleETA, cached.eta, isMoving, distanceMoved);
                
            } else if (typeof cached.eta === 'number') {
                 googleETA = cached.eta; 
            }

            if (shouldRefreshRoute) {
                googleApiCallCount.directions++;
                googleRoute = await getRouteFromGoogle(
                    lat,
                    lng,
                    destination.lat,
                    destination.lon
                );
                updatedCache.route = googleRoute;
                updatedCache.routeLastUpdate = now;
            } else if (!googleRoute && Array.isArray(cached.route)) {
                googleRoute = cached.route;
            }

            // Update last position and persist cache
            updatedCache.lastPosition = { lat, lng };
            googleApiCache.set(cacheKey, updatedCache);
        } catch (error) {
            console.error(
                `[Bus ${busId}] ❌ GOOGLE API ERROR:`,
                error.message
            );
            if (typeof cached.eta === 'number' && googleETA == null) {
                googleETA = cached.eta;
            }
            if (Array.isArray(cached.route) && !googleRoute) {
                googleRoute = cached.route;
            }
        }
    } else {
        if (!isMoving) {
             etaStatus = { status: 'stopped', message: 'Bus is stopped and holding' };
        }
    }
    
    // --- FINAL ETA CALCULATION ---
    let stopsLeft = 0;
    let dwellTimeBuffer = 0;
    
    if (googleETA !== null && googleETA > 0) {
        stopsLeft = getRemainingStops(busId, currentPosition, destination);
        dwellTimeBuffer = stopsLeft * DWELL_TIME_PER_STOP;
        
        finalETASeconds = googleETA + dwellTimeBuffer;
    } else {
        finalETASeconds = 0;
    }

    const finalETA = secondsToMinutes(finalETASeconds);

    // --- LOG FINAL PAYLOAD ---
    console.log(`[Bus ${busId}] 🚚 FINAL PAYLOAD:`);
    console.log(`    > Start: (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
    console.log(`    > End: (${destination.lat}, ${destination.lon})`);
    console.log(`    > Google ETA: ${googleETA ? secondsToMinutes(googleETA) + ' min (' + googleETA.toFixed(0) + 's)' : 'N/A'}`);
    console.log(`    > Dwell Buffer: ${dwellTimeBuffer}s (${stopsLeft} stops)`);
    console.log(`    > FINAL ETA: ${finalETA} minutes (${finalETASeconds.toFixed(0)}s)`);
    console.log(`    > Status: ${etaStatus.status} (${etaStatus.message})`);
    // ---------------------------

    return {
        busId: busId,
        plateNumber: device.plate_number || `Bus ${busId}`,
        currentPosition: currentPosition, 
        occupancyRate: getOccupancy(), 
        eta: finalETA, 
        etaSeconds: finalETASeconds, 
        isMoving: isMoving,
        route: googleRoute, 
        speed: rawSpeed, 
        lastUpdate: device.last_update,
        timestamp: Date.now(),
        etaStatus: etaStatus.status, 
        etaMessage: etaStatus.message,
    };
};

// --- API POLLING AND BROADCAST ---

async function fetchLiveDevices() {
    console.log(`\n--- DEVICE POLL START @ ${new Date().toLocaleTimeString()} (Interval: ${POLL_INTERVAL_MS}ms) ---`);
    try {
        let devices = [];
        
        if (USE_DUMMY_GPS) {
            devices = generateDummyGPSData({
                busCount: DUMMY_BUS_COUNT,
                updateInterval: DUMMY_UPDATE_INTERVAL,
                destination: DEFAULT_DESTINATION,
            });
            latestDevices = devices;
            lastFetchedAt = new Date().toISOString();
            lastFetchError = null;
            
            if (devices.length > 0) {
                const movingCount = devices.filter(d => d.last_speed > 0).length;
                console.log(`[Dummy GPS] ${movingCount}/${devices.length} buses moving. Processing ETA for ${devices.length} devices.`);
            }
        } else {
            const response = await axios.get(DEVICE_API_URL, { timeout: 10000 });
            if (response.data?.success && Array.isArray(response.data.data)) {
                latestDevices = response.data.data;
                lastFetchedAt = new Date().toISOString();
                lastFetchError = null;
                console.log(`[API Fetch] Successfully fetched ${latestDevices.length} devices. Processing ETA...`);
            } else {
                throw new Error('Unexpected response structure from device API');
            }
        }
        await broadcastLiveDevices(latestDevices);
    } catch (error) {
        lastFetchError = error?.message || 'Unknown error fetching devices';
        console.error('[Device Poll] Failed to fetch devices:', lastFetchError);
    }
}

async function broadcastLiveDevices(devices) {
    const payloads = await Promise.all(
        devices.map(async (device) => {
            try {
                return await mapDeviceToSocketPayload(device);
            } catch (error) {
                // Fixed: The error reporting was inside the loop where handleNotifications 
                // might not have been defined yet, causing console errors in the logs.
                console.error(`[Server] Error processing device ${device.device_id}: ${error.message}`);
                return null;
            }
        })
    );

    payloads.forEach((payload) => {
        if (payload && payload.currentPosition) {
            io.emit('route-update', payload);
            handleNotifications(payload);
        }
    });

    io.emit('devices-snapshot', {
        timestamp: lastFetchedAt,
        count: devices.length,
        devices,
    });
}

// Log API call statistics periodically
setInterval(() => {
    const now = Date.now();
    const elapsedMinutes = (now - lastApiCallReset) / 60000;
    if (elapsedMinutes >= 1) {
        console.log(`[API Stats] Distance Matrix: ${googleApiCallCount.distanceMatrix} calls, Directions: ${googleApiCallCount.directions} calls in last ${elapsedMinutes.toFixed(1)} min`);
        googleApiCallCount = { distanceMatrix: 0, directions: 0 };
        lastApiCallReset = now;
    }
}, 60000); 

setInterval(fetchLiveDevices, POLL_INTERVAL_MS);
fetchLiveDevices();

// --- PUSH NOTIFICATION ENDPOINTS AND LOGIC ---

// Missing function handleNotifications (FIX 3: Added definition)
function handleNotifications(payload) {
    const { busId, eta, occupancyRate } = payload;
    if (!busId || !notificationSubscriptions.has(busId)) return;
    // ... (Your notification logic)
    const subscriptions = notificationSubscriptions.get(busId);
    subscriptions.forEach((subscription) => {
        if (eta <= subscription.notificationTime && !subscription.notified) { 
            subscription.notified = true;

            const title = `🚌 Bus ${payload.plateNumber || busId} Arriving Soon!`;
            const body = `ETA: ${eta} min | Occupancy: ${occupancyRate}%`;

            // Assume sendPushNotification is defined elsewhere or imported if not here
            // sendPushNotification(...) 
        }
    });
}
// Assume sendPushNotification is defined here or imported...

// API endpoint to register notification subscription
app.post('/api/register-notification', (req, res) => {
    const { busId, notificationTime, pushToken } = req.body;

    if (!busId || !notificationTime || !pushToken) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!Expo.isExpoPushToken(pushToken)) {
        return res.status(400).json({ error: 'Invalid Expo push token' });
    }

    if (!notificationSubscriptions.has(busId)) {
        notificationSubscriptions.set(busId, []);
    }

    const subscriptions = notificationSubscriptions.get(busId);
    
    const existingIndex = subscriptions.findIndex(sub => sub.pushToken === pushToken);
    
    if (existingIndex >= 0) {
        subscriptions[existingIndex] = {
            pushToken,
            notificationTime: parseInt(notificationTime, 10),
            notified: false 
        };
    } else {
        subscriptions.push({
            pushToken,
            notificationTime: parseInt(notificationTime, 10),
            notified: false
        });
    }

    console.log(`[Notification] Registered for bus ${busId}: ${notificationTime} min, token: ${pushToken.substring(0, 20)}...`);
    res.json({ success: true });
});

// API endpoint to unregister notification subscription
app.post('/api/unregister-notification', (req, res) => {
    const { busId, pushToken } = req.body;

    if (!busId || !pushToken) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    if (notificationSubscriptions.has(busId)) {
        const subscriptions = notificationSubscriptions.get(busId);
        const index = subscriptions.findIndex(sub => sub.pushToken === pushToken);
        
        if (index >= 0) {
            subscriptions.splice(index, 1);
            console.log(`[Notification] Unregistered for bus ${busId}`);
            
            if (subscriptions.length === 0) {
                notificationSubscriptions.delete(busId);
            }
        }
    }
    res.json({ success: true });
});


// Socket.IO connection handling
io.on('connection', async (socket) => {
    console.log('Client connected:', socket.id);
    
    // Send initial snapshot to new client
    if (latestDevices.length > 0) {
        try {
            const payloads = await Promise.all(
                latestDevices.map((device) => mapDeviceToSocketPayload(device))
            );

            payloads.forEach((payload) => {
                if (payload && payload.currentPosition) {
                    socket.emit('route-update', payload);
                }
            });
        } catch (error) {
            console.error('[Socket] Error preparing initial payloads:', error.message);
        }

        socket.emit('devices-snapshot', {
            timestamp: lastFetchedAt,
            count: latestDevices.length,
            devices: latestDevices,
        });
    }

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});