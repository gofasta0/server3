/**
 * Dummy GPS for ETA testing
 * - Short Kigali route
 * - ~10 minutes total
 * - Simulates traffic with speed fluctuations
 * - Adds small GPS noise
 */

const START = { lat: -1.936567, lng: 30.130141 }; // Kimironko
const DESTINATION = { lat: -1.9683524, lng: 30.0890925 }; // Kicukiro
const UPDATE_SEC = 10; // seconds

// Calculate speed automatically so distance is covered in ~10 min
const totalDistance = distanceMeters(START, DESTINATION); // meters
const TARGET_TIME_SEC = 10 * 60; // 10 minutes in seconds
const BASE_SPEED_KMH = (totalDistance / 1000) / (TARGET_TIME_SEC / 3600); // km/h

if (!global.dummyBus) {
  global.dummyBus = {
    lat: START.lat,
    lng: START.lng,
    lastUpdate: Date.now(),
  };
}

function toRad(d) {
  return (d * Math.PI) / 180;
}

function distanceMeters(a, b) {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) *
      Math.cos(toRad(b.lat)) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function moveTowards(from, to, meters) {
  const dist = distanceMeters(from, to);
  if (dist === 0 || meters >= dist) return to;

  const r = meters / dist;
  return {
    lat: from.lat + (to.lat - from.lat) * r,
    lng: from.lng + (to.lng - from.lng) * r,
  };
}

export function getDummyDevice() {
  const now = Date.now();
  const elapsed = Math.max(
    UPDATE_SEC,
    (now - global.dummyBus.lastUpdate) / 1000
  );

  // Add random traffic factor: 70% - 130% of base speed
  const trafficFactor = 0.7 + Math.random() * 0.6; 
  const speedKmh = BASE_SPEED_KMH * trafficFactor;

  const distance = (speedKmh / 3.6) * elapsed; // meters

  const next = moveTowards(
    { lat: global.dummyBus.lat, lng: global.dummyBus.lng },
    DESTINATION,
    distance
  );

  global.dummyBus = { ...next, lastUpdate: now };

  // Small GPS noise ~3m
  const noise = () => (Math.random() - 0.5) * 0.00003;

  return {
    device_id: 'BUS_DUMMY_001',
    plate_number: 'RAA-DUMMY',
    last_lat: next.lat + noise(),
    last_lon: next.lng + noise(),
    last_speed: Number(speedKmh.toFixed(1)), // current speed in km/h
    last_update: new Date(now).toISOString(),
  };
}
