/**
 * Google Maps API Utilities
 * 
 * Provides functions to:
 * - Get ETA using Distance Matrix API
 * - Get route path using Directions API
 */

import axios from 'axios';

// Function to get API key (reads from env each time, so it works even if dotenv loads after import)
function getGoogleMapsApiKey() {
  return process.env.GOOGLE_MAPS_API_KEY || 
         process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
         null;
}

/**
 * Get ETA using Google Distance Matrix API
 * 
 * @param {number} originLat - Origin latitude
 * @param {number} originLon - Origin longitude
 * @param {number} destLat - Destination latitude
 * @param {number} destLon - Destination longitude
 * @returns {Promise<{duration: number, distance: number}>} Duration in seconds, distance in meters
 */
export async function getETAFromGoogle(originLat, originLon, destLat, destLon) {
  const GOOGLE_MAPS_API_KEY = getGoogleMapsApiKey();
  
  if (!GOOGLE_MAPS_API_KEY) {
    console.warn('[Google Maps] API key not found, cannot calculate ETA');
    return { duration: null, distance: null };
  }

  // API call is tracked in server/index.js

  try {
    const url = 'https://maps.googleapis.com/maps/api/distancematrix/json';
    const params = {
      origins: `${originLat},${originLon}`,
      destinations: `${destLat},${destLon}`,
      mode: 'driving',
      key: GOOGLE_MAPS_API_KEY,
      departure_time: 'now', // Use current traffic conditions
    };

    const response = await axios.get(url, { params, timeout: 5000 });
    
    // Debug: Log API response status
    if (process.env.NODE_ENV !== 'production') {
      console.log('[Google Maps] Distance Matrix API response:', {
        status: response.data.status,
        hasRows: !!response.data.rows,
        elementStatus: response.data.rows?.[0]?.elements?.[0]?.status
      });
    }
    
    if (response.data.status === 'OK' && response.data.rows?.[0]?.elements?.[0]) {
      const element = response.data.rows[0].elements[0];
      
      if (element.status === 'OK') {
        // Duration in seconds (use duration_in_traffic if available, otherwise duration)
        const duration = element.duration_in_traffic?.value || element.duration?.value || null;
        const distance = element.distance?.value || null; // Distance in meters
        
        // Debug: Log successful response
        if (process.env.NODE_ENV !== 'production') {
          console.log('[Google Maps] Distance Matrix success:', {
            duration: duration ? `${duration}s (${Math.round(duration/60)}min)` : 'null',
            distance: distance ? `${(distance/1000).toFixed(2)} km` : 'null'
          });
        }
        
        return { duration, distance };
      } else {
        console.warn('[Google Maps] Distance Matrix API error:', element.status);
        return { duration: null, distance: null };
      }
    } else {
      console.warn('[Google Maps] Distance Matrix API error:', response.data.status);
      if (response.data.error_message) {
        console.warn('[Google Maps] Error message:', response.data.error_message);
      }
      return { duration: null, distance: null };
    }
  } catch (error) {
    console.error('[Google Maps] Error fetching ETA:', error.message);
    return { duration: null, distance: null };
  }
}

/**
 * Get route path using Google Directions API
 * 
 * @param {number} originLat - Origin latitude
 * @param {number} originLon - Origin longitude
 * @param {number} destLat - Destination latitude
 * @param {number} destLon - Destination longitude
 * @returns {Promise<Array<{lat: number, lng: number}>>} Array of route points
 */
export async function getRouteFromGoogle(originLat, originLon, destLat, destLon) {
  const GOOGLE_MAPS_API_KEY = getGoogleMapsApiKey();
  
  if (!GOOGLE_MAPS_API_KEY) {
    console.warn('[Google Maps] API key not found, cannot fetch route');
    return [];
  }

  try {
    const url = 'https://maps.googleapis.com/maps/api/directions/json';
    const params = {
      origin: `${originLat},${originLon}`,
      destination: `${destLat},${destLon}`,
      mode: 'driving',
      key: GOOGLE_MAPS_API_KEY,
      alternatives: false, // Only get best route
    };

    const response = await axios.get(url, { params, timeout: 5000 });
    
    if (response.data.status === 'OK' && response.data.routes?.[0]) {
      const route = response.data.routes[0];
      const polyline = route.overview_polyline?.points;
      
      if (polyline) {
        return decodePolyline(polyline);
      } else {
        // Fallback: return start and end points
        return [
          { lat: originLat, lng: originLon },
          { lat: destLat, lng: destLon }
        ];
      }
    } else {
      console.warn('[Google Maps] Directions API error:', response.data.status);
      // Fallback: return start and end points
      return [
        { lat: originLat, lng: originLon },
        { lat: destLat, lng: destLon }
      ];
    }
  } catch (error) {
    console.error('[Google Maps] Error fetching route:', error.message);
    // Fallback: return start and end points
    return [
      { lat: originLat, lng: originLon },
      { lat: destLat, lng: destLon }
    ];
  }
}

/**
 * Decode Google Maps polyline string to array of coordinates
 * 
 * @param {string} encoded - Encoded polyline string
 * @returns {Array<{lat: number, lng: number}>} Array of coordinates
 */
function decodePolyline(encoded) {
  const poly = [];
  let index = 0;
  const len = encoded.length;
  let lat = 0;
  let lng = 0;

  while (index < len) {
    let b;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    poly.push({ lat: lat * 1e-5, lng: lng * 1e-5 });
  }

  return poly;
}

