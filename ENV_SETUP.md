# Environment Variables Setup

## Quick Start

1. **Create a `.env` file** in the `server` directory with the following content:

```env
# Backend API URL
DEVICE_API_URL=https://gofasta.onrender.com/api/devices

# Polling interval in milliseconds
POLL_INTERVAL_MS=4000

# Dummy GPS Mode (for testing without real GPS devices)
USE_DUMMY_GPS=true

# Number of dummy buses to generate
DUMMY_BUS_COUNT=3

# Dummy GPS update interval in seconds
DUMMY_UPDATE_INTERVAL=10

# Google Maps API Key (required for ETA and route calculation)
```

2. **Start the server**:
```bash
npm start
```

That's it! The server will automatically load the `.env` file.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DEVICE_API_URL` | Backend API URL for fetching GPS data | `https://gofasta.onrender.com/api/devices` |
| `POLL_INTERVAL_MS` | How often to poll backend for updates (ms) | `4000` |
| `USE_DUMMY_GPS` | Enable dummy GPS mode for testing | `false` |
| `DUMMY_BUS_COUNT` | Number of dummy buses to generate | `3` |
| `DUMMY_UPDATE_INTERVAL` | Dummy GPS update interval (seconds) | `10` |
| `GOOGLE_MAPS_API_KEY` | Google Maps API key for ETA/route calculation | (required) |

## Switching Between Modes

### Use Dummy GPS (Testing)
```env
USE_DUMMY_GPS=true
DUMMY_BUS_COUNT=3
DUMMY_UPDATE_INTERVAL=10
```

### Use Real GPS (Production)
```env
USE_DUMMY_GPS=false
```

## Notes

- The `.env` file is automatically ignored by git (in `.gitignore`)
- Never commit your `.env` file with real API keys
- Use `.env.example` as a template for other developers

