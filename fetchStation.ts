import { fetchContentful } from "@/config/contentful";

// Define your field structures
interface StationFields {
  name: string;
  location: { lat: number; lon: number };
}

interface RouteFields {
  name: string;
  startStation: { sys: { id: string } };
  endStation: { sys: { id: string } };
}

interface BusFields {
  plateNumber: string;
  route?: { sys: { id: string } };
}

// Haversine formula
function getDistanceInKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ✅ Fetch stations
export const fetchStations = async () => {
  try {
    const data = await fetchContentful("station");

    if (!data || !data.items || !Array.isArray(data.items)) {
      console.warn("Invalid data structure from Contentful:", data);
      return [];
    }

    return data.items.map((item: any) => ({
      id: item.sys?.id || `station-${Math.random()}`,
      name: item.fields?.name || "Unknown Station",
      location: {
        lat: item.fields?.location?.lat || 0,
        lon: item.fields?.location?.lon || 0,
      },
    }));
  } catch (error: any) {
    console.error("Error fetching stations from Contentful:", error);
    throw new Error(
      `Failed to fetch stations: ${error?.message || "Unknown error"}`
    );
  }
};

// ✅ Fetch buses and compute proximity
export const fetchMatchingBuses = async ({
  currentLocation,
  destination,
}: {
  currentLocation: { lat: number; lon: number };
  destination: { lat: number; lon: number };
}) => {
  const data = await fetchContentful("bus", 4);
  const buses = data.items;
  const includes = data.includes || {};

  // Linked routes and stations
  const routeMap = new Map<string, any>();
  const stationMap = new Map<string, any>();

  for (const entry of includes.Entry || []) {
    const type = entry.sys.contentType.sys.id;
    if (type === "route") routeMap.set(entry.sys.id, entry);
    if (type === "station") stationMap.set(entry.sys.id, entry);
  }

  const results = buses
    .map((bus: any) => {
      const routeId = bus.fields.route?.sys?.id;
      const route = routeMap.get(routeId);
      if (!route) return null;

      const startId = route.fields.startStation?.sys?.id;
      const endId = route.fields.endStation?.sys?.id;

      const startStation = stationMap.get(startId);
      const endStation = stationMap.get(endId);

      if (!startStation || !endStation) return null;

      const startDistance = getDistanceInKm(
        startStation.fields.location.lat,
        startStation.fields.location.lon,
        currentLocation.lat,
        currentLocation.lon
      );

      const endDistance = getDistanceInKm(
        endStation.fields.location.lat,
        endStation.fields.location.lon,
        destination.lat,
        destination.lon
      );

      return {
        plateNumber: bus.fields.plateNumber,
        routeName: route.fields.name,
        startStation: {
          name: startStation.fields.name,
          location: startStation.fields.location,
        },
        endStation: {
          name: endStation.fields.name,
          location: endStation.fields.location,
        },
        startDistance,
        endDistance,
        totalDistance: startDistance + endDistance,
      };
    })
    .filter(Boolean)
    .filter((bus: any) => bus!.startDistance <= 10 && bus!.endDistance <= 10)
    .sort((a: any, b: any) => a!.totalDistance - b!.totalDistance);

  return results;
};
