/**
 * GPS Smoothing Utilities
 * 
 * Provides Kalman filtering, exponential moving averages, and speed smoothing
 * for stable ETA predictions and smooth GPS tracking.
 */

/**
 * Simple Kalman Filter for 1D values (speed, ETA)
 * 
 * Formula:
 * - Prediction: x_k = x_{k-1}
 * - Update: x_k = x_k + K * (z - x_k)
 * - Kalman Gain: K = P / (P + R)
 * - Error Covariance: P = P - K * P
 * 
 * @param {Object} state - Previous filter state { value, errorCovariance }
 * @param {number} measurement - New measurement
 * @param {number} processNoise - Process noise (Q) - how much we trust the model
 * @param {number} measurementNoise - Measurement noise (R) - how much we trust measurements
 * @returns {Object} Updated state { value, errorCovariance }
 */
function kalmanFilter1D(state, measurement, processNoise = 0.01, measurementNoise = 0.25) {
  if (!state) {
    // Initialize filter
    return {
      value: measurement,
      errorCovariance: 1.0
    };
  }

  // Prediction step
  let predictedValue = state.value;
  let predictedErrorCovariance = state.errorCovariance + processNoise;

  // Update step
  const kalmanGain = predictedErrorCovariance / (predictedErrorCovariance + measurementNoise);
  const updatedValue = predictedValue + kalmanGain * (measurement - predictedValue);
  const updatedErrorCovariance = (1 - kalmanGain) * predictedErrorCovariance;

  return {
    value: updatedValue,
    errorCovariance: updatedErrorCovariance
  };
}

/**
 * 2D Kalman Filter for GPS coordinates (lat, lng)
 * 
 * Uses separate 1D filters for latitude and longitude
 * 
 * @param {Object} state - Previous filter state { lat, lng, latError, lngError }
 * @param {Object} measurement - New GPS measurement { lat, lng }
 * @param {number} processNoise - Process noise
 * @param {number} measurementNoise - Measurement noise (GPS accuracy ~5-10m)
 * @returns {Object} Updated state
 */
function kalmanFilter2D(state, measurement, processNoise = 0.00001, measurementNoise = 0.0001) {
  if (!state || !state.lat || !state.lng) {
    return {
      lat: measurement.lat,
      lng: measurement.lng,
      latError: 0.0001,
      lngError: 0.0001
    };
  }

  const latFilter = kalmanFilter1D(
    { value: state.lat, errorCovariance: state.latError },
    measurement.lat,
    processNoise,
    measurementNoise
  );

  const lngFilter = kalmanFilter1D(
    { value: state.lng, errorCovariance: state.lngError },
    measurement.lng,
    processNoise,
    measurementNoise
  );

  return {
    lat: latFilter.value,
    lng: lngFilter.value,
    latError: latFilter.errorCovariance,
    lngError: lngFilter.errorCovariance
  };
}

/**
 * Exponential Moving Average (EMA)
 * 
 * Formula: EMA = α * new_value + (1 - α) * previous_EMA
 * 
 * α (alpha) determines how much weight to give new values:
 * - Higher α (0.3-0.5) = more responsive, less smooth
 * - Lower α (0.1-0.2) = smoother, less responsive
 * 
 * @param {number} previousValue - Previous EMA value
 * @param {number} newValue - New measurement
 * @param {number} alpha - Smoothing factor (0-1), default 0.2
 * @returns {number} New EMA value
 */
function exponentialMovingAverage(previousValue, newValue, alpha = 0.2) {
  if (previousValue === null || previousValue === undefined) {
    return newValue;
  }
  return alpha * newValue + (1 - alpha) * previousValue;
}

/**
 * Speed Smoothing
 * 
 * Combines Kalman filter and EMA for stable speed estimates
 * 
 * @param {Object} state - Previous state { speed, speedFilter, speedEMA }
 * @param {number} newSpeed - New speed measurement (km/h)
 * @returns {Object} Updated state with smoothed speed
 */
function smoothSpeed(state, newSpeed) {
  if (newSpeed === null || newSpeed === undefined || isNaN(newSpeed)) {
    return state || { speed: 0, speedFilter: null, speedEMA: 0 };
  }

  // Clamp speed to reasonable values (0-120 km/h)
  const clampedSpeed = Math.max(0, Math.min(120, newSpeed));

  // Apply Kalman filter
  const speedFilter = kalmanFilter1D(
    state?.speedFilter,
    clampedSpeed,
    0.5, // Process noise - speed can change quickly
    2.0  // Measurement noise - GPS speed can be noisy
  );

  // Apply EMA for additional smoothing
  const speedEMA = exponentialMovingAverage(
    state?.speedEMA ?? clampedSpeed,
    speedFilter.value,
    0.3 // More responsive to speed changes
  );

  return {
    speed: Math.max(0, speedEMA),
    speedFilter: speedFilter,
    speedEMA: speedEMA
  };
}

/**
 * ETA Smoothing
 * 
 * Uses multiple techniques to prevent ETA from jumping:
 * 1. Kalman filter on raw ETA
 * 2. EMA on filtered ETA
 * 3. Speed-based adjustment
 * 
 * @param {Object} state - Previous state { eta, etaFilter, etaEMA, smoothedSpeed }
 * @param {number} rawETA - Raw ETA in seconds
 * @param {number} smoothedSpeed - Smoothed speed (km/h)
 * @param {number} distance - Distance to destination (meters)
 * @returns {Object} Updated state with smoothed ETA
 */
function smoothETA(state, rawETA, smoothedSpeed, distance) {
  if (rawETA === null || rawETA === undefined || isNaN(rawETA) || rawETA < 0) {
    return state || { eta: 0, etaFilter: null, etaEMA: 0 };
  }

  // Clamp ETA to reasonable values (0-3600 seconds = 1 hour max)
  const clampedETA = Math.max(0, Math.min(3600, rawETA));

  // Google Maps style: ETA should decrease smoothly, never jump
  // Maximum change per update: 5% decrease or 2% increase
  let targetETA = clampedETA;
  if (state?.etaEMA !== undefined && state.etaEMA > 0) {
    const previousETA = state.etaEMA;
    
    // Calculate maximum allowed change
    const maxDecrease = previousETA * 0.05; // Max 5% decrease per update
    const maxIncrease = previousETA * 0.02; // Max 2% increase per update
    
    if (clampedETA < previousETA - maxDecrease) {
      // ETA decreased too much - limit to max decrease
      targetETA = previousETA - maxDecrease;
    } else if (clampedETA > previousETA + maxIncrease) {
      // ETA increased too much - limit to max increase
      targetETA = previousETA + maxIncrease;
    } else {
      // Change is within limits - use it
      targetETA = clampedETA;
    }
  }

  // Apply Kalman filter with very low process noise for ultra-smooth ETA
  const etaFilter = kalmanFilter1D(
    state?.etaFilter,
    targetETA,
    1.0,  // Very low process noise - ETA changes very smoothly
    15.0  // Measurement noise - ETA calculations can vary
  );

  // Apply EMA with very low alpha for Google Maps style smooth decrease
  // Use even lower alpha for more stability
  const etaEMA = exponentialMovingAverage(
    state?.etaEMA ?? targetETA,
    etaFilter.value,
    0.05 // Very low alpha = ultra-smooth ETA (prevents jumps)
  );

  // Final adjustment: ensure ETA only changes gradually
  // Don't use speed-based adjustment - it causes jumps
  // Just use the smoothed EMA value
  let adjustedETA = etaEMA;
  
  // One final check: ensure change from previous is not too large
  if (state?.etaEMA !== undefined && state.etaEMA > 0) {
    const maxChange = state.etaEMA * 0.05; // Max 5% change
    if (Math.abs(adjustedETA - state.etaEMA) > maxChange) {
      // Change too large - clamp it
      if (adjustedETA < state.etaEMA) {
        adjustedETA = state.etaEMA - maxChange; // Decrease
      } else {
        adjustedETA = state.etaEMA + maxChange; // Increase
      }
    }
  }

  // Ensure ETA never goes below 0
  return {
    eta: Math.max(0, adjustedETA),
    etaFilter: etaFilter,
    etaEMA: adjustedETA
  };
}

/**
 * GPS Position Smoothing
 * 
 * Smooths GPS coordinates to reduce jitter
 * 
 * @param {Object} state - Previous state { position, positionFilter }
 * @param {Object} newPosition - New GPS position { lat, lng }
 * @returns {Object} Updated state with smoothed position
 */
function smoothPosition(state, newPosition) {
  if (!newPosition || !newPosition.lat || !newPosition.lng) {
    return state;
  }

  const positionFilter = kalmanFilter2D(
    state?.positionFilter,
    newPosition,
    0.00001, // Process noise - position changes smoothly
    0.0001   // Measurement noise - GPS accuracy
  );

  return {
    position: {
      lat: positionFilter.lat,
      lng: positionFilter.lng
    },
    positionFilter: positionFilter
  };
}

/**
 * Bus State Manager
 * 
 * Maintains smoothing state for a single bus
 */
class BusSmoothingState {
  constructor(busId) {
    this.busId = busId;
    this.speedState = null;
    this.etaState = null;
    this.positionState = null;
    this.lastUpdate = null;
    this.history = []; // Keep last 5 positions for trajectory prediction
  }

  /**
   * Update with new GPS data
   * 
   * @param {Object} device - Device data from backend
   * @param {Object} destination - Destination { lat, lng }
   * @param {Function} haversineDistance - Haversine distance function
   * @returns {Object} Smoothed data { position, speed, eta }
   */
  update(device, destination, haversineDistance) {
    
    // Smooth position
    const newPosition = { lat: device.last_lat, lng: device.last_lon };
    this.positionState = smoothPosition(this.positionState, newPosition);
    
    // Smooth speed
    this.speedState = smoothSpeed(this.speedState, device.last_speed);
    
    // Calculate distance to destination
    let distance = 0;
    if (destination && destination.lat && destination.lng) {
      distance = haversineDistance(
        this.positionState.position.lat,
        this.positionState.position.lng,
        destination.lat,
        destination.lng
      );
    }
    
    // Calculate raw ETA
    // Use etaSeconds from device if available (real GPS), otherwise calculate from distance/speed
    let rawETA = null;
    if (device.etaSeconds !== null && device.etaSeconds !== undefined && !isNaN(device.etaSeconds)) {
      // Real GPS data already has ETA calculated
      rawETA = device.etaSeconds;
    } else {
      // Calculate ETA from distance and speed (for dummy GPS or when ETA not provided)
      const speedMs = this.speedState.speed / 3.6; // km/h to m/s
      rawETA = speedMs > 0 && distance > 0 ? distance / speedMs : null;
    }
    
    // Smooth ETA
    this.etaState = smoothETA(
      this.etaState,
      rawETA,
      this.speedState.speed,
      distance
    );
    
    // Update history (keep last 5 positions)
    this.history.push({
      position: { ...this.positionState.position },
      timestamp: Date.now(),
      speed: this.speedState.speed
    });
    if (this.history.length > 5) {
      this.history.shift();
    }
    
    this.lastUpdate = new Date();
    
    return {
      position: this.positionState.position,
      speed: this.speedState.speed,
      eta: this.etaState.eta,
      rawETA: rawETA,
      distance: distance
    };
  }

  /**
   * Predict next position based on current trajectory
   * 
   * @param {number} secondsAhead - How many seconds to predict ahead
   * @param {Function} haversineDistance - Haversine distance function
   * @returns {Object|null} Predicted position { lat, lng } or null
   */
  predictPosition(secondsAhead = 1, haversineDistance) {
    if (this.history.length < 2 || !this.positionState) {
      return null;
    }
    
    // Calculate average velocity from history
    const recent = this.history.slice(-3); // Last 3 positions
    if (recent.length < 2) return null;
    
    const latest = recent[recent.length - 1];
    const previous = recent[0];
    const timeDiff = (latest.timestamp - previous.timestamp) / 1000; // seconds
    
    if (timeDiff <= 0) return null;
    
    // Calculate velocity (m/s)
    const distance = haversineDistance(
      previous.position.lat,
      previous.position.lng,
      latest.position.lat,
      latest.position.lng
    );
    const velocity = distance / timeDiff; // m/s
    
    // Calculate bearing
    const bearing = calculateBearing(
      previous.position.lat,
      previous.position.lng,
      latest.position.lat,
      latest.position.lng
    );
    
    // Predict position
    const distanceAhead = velocity * secondsAhead; // meters
    return movePosition(
      latest.position.lat,
      latest.position.lng,
      bearing,
      distanceAhead
    );
  }
}

/**
 * Calculate bearing between two points
 * 
 * @param {number} lat1 
 * @param {number} lon1 
 * @param {number} lat2 
 * @param {number} lon2 
 * @returns {number} Bearing in degrees (0-360)
 */
function calculateBearing(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;
  const toDeg = d => d * 180 / Math.PI;
  
  const dLon = toRad(lon2 - lon1);
  const lat1Rad = toRad(lat1);
  const lat2Rad = toRad(lat2);
  
  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
            Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
  
  let bearing = toDeg(Math.atan2(y, x));
  return (bearing + 360) % 360;
}

/**
 * Move a position by distance and bearing
 * 
 * @param {number} lat 
 * @param {number} lon 
 * @param {number} bearing - Bearing in degrees
 * @param {number} distance - Distance in meters
 * @returns {Object} New position { lat, lng }
 */
function movePosition(lat, lon, bearing, distance) {
  const R = 6371000; // Earth radius in meters
  const toRad = d => d * Math.PI / 180;
  const toDeg = d => d * 180 / Math.PI;
  
  const latRad = toRad(lat);
  const lonRad = toRad(lon);
  const bearingRad = toRad(bearing);
  const angularDistance = distance / R;
  
  const newLat = Math.asin(
    Math.sin(latRad) * Math.cos(angularDistance) +
    Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearingRad)
  );
  
  const newLon = lonRad + Math.atan2(
    Math.sin(bearingRad) * Math.sin(angularDistance) * Math.cos(latRad),
    Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(newLat)
  );
  
  return {
    lat: toDeg(newLat),
    lng: toDeg(newLon)
  };
}

export {
  kalmanFilter1D,
  kalmanFilter2D,
  exponentialMovingAverage,
  smoothSpeed,
  smoothETA,
  smoothPosition,
  BusSmoothingState,
  calculateBearing,
  movePosition
};

