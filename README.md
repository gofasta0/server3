# GoFasta Real-time Server

Real-time bus tracking server with Google Maps integration and WebSocket support.

## Features

- Real-time bus route tracking
- Google Maps route calculation
- WebSocket-based real-time updates
- Server UI for monitoring and control
- Route visualization (red for remaining, blue for completed)
- ETA and occupancy rate simulation

## Setup

1. Install dependencies:
```bash
cd server
npm install
```

2. Make sure you have a Google Maps API key with the following APIs enabled:
   - Directions API
   - Maps JavaScript API

3. Update the API key in `index.js`:
```javascript
const GOOGLE_MAPS_API_KEY = 'YOUR_API_KEY_HERE';
```

4. Start the server:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

The server will start on `http://localhost:3001`

## API Endpoints

### POST /api/track-bus
Start tracking a bus on a route.

Request body:
```json
{
  "busId": "BUS-001",
  "startStation": {
    "name": "Start Station",
    "location": {
      "lat": -1.9441,
      "lon": 30.0619
    }
  },
  "endStation": {
    "name": "End Station",
    "location": {
      "lat": -1.9706,
      "lon": 30.1044
    }
  }
}
```

### POST /api/stop-bus
Stop tracking a bus.

Request body:
```json
{
  "busId": "BUS-001"
}
```

### GET /api/buses
Get all active buses with their current status.

## WebSocket Events

### Client → Server
- `connect` - Client connects
- `disconnect` - Client disconnects

### Server → Client
- `route-update` - Real-time route update
  ```json
  {
    "busId": "BUS-001",
    "route": [...],
    "completedRoute": [...],
    "remainingRoute": [...],
    "currentPosition": { "lat": ..., "lng": ... },
    "occupancyRate": 75,
    "eta": 5,
    "isMoving": true
  }
  ```

- `bus-stopped` - Bus tracking stopped
  ```json
  {
    "busId": "BUS-001"
  }
  ```

## Server UI

Access the server UI at `http://localhost:3001` to:
- Start/stop bus tracking
- View active buses
- Monitor real-time routes on Google Maps
- See ETA and occupancy rates

## Integration with Expo App

The Expo app connects to this server via WebSocket. Make sure to update the `SERVER_URL` in `app/BusesScreen.tsx` to match your server address.

For local development:
- iOS Simulator: `http://localhost:3001`
- Android Emulator: `http://10.0.2.2:3001`
- Physical device: `http://YOUR_COMPUTER_IP:3001`

