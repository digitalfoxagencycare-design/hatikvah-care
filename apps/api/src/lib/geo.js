/**
 * Geo and Logistics Calculation Engine:
 * Plus Code decoding, Hyderabad PIN code geocoding, Haversine distance, and dynamic freight calculation.
 */

export const DEFAULT_WAREHOUSE = {
  plusCode: "F9C3+CC JV Hills, Hyderabad, Telangana",
  pincode: "500084",
  address: "Eshwar Nilayam, Plot No. 4-1447, Kondapur Golden Tulip Estate, JV Hills, Gachibowli, Hyderabad, Telangana – 500084",
  lat: 17.4710,
  lng: 78.3535,
  name: "HaTikvah Care Central Warehouse (JV Hills)"
};

const OLC_ALPHABET = "23456789CFGHJMPQRVWX";

/** Decodes a Google Plus Code (full or short with Hyderabad default 7J9W prefix) */
export function decodePlusCode(code, defaultPrefix = "7J9W") {
  if (!code || typeof code !== "string") return null;
  const match = code.match(/([23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3})/i);
  if (!match) return null;
  let clean = match[1].toUpperCase();
  if (clean.startsWith("+")) return null;
  const parts = clean.split("+");
  if (parts[0].length === 4) {
    clean = defaultPrefix + clean;
  }
  const full = clean.replace("+", "");
  if (full.length < 8) return null;
  let latVal = 0, lngVal = 0, latRes = 20, lngRes = 20;
  for (let i = 0; i < 10 && i < full.length; i += 2) {
    const latIdx = OLC_ALPHABET.indexOf(full[i]);
    const lngIdx = OLC_ALPHABET.indexOf(full[i + 1]);
    if (latIdx < 0 || lngIdx < 0) return null;
    latRes /= 20;
    lngRes /= 20;
    latVal += latIdx * latRes * 20;
    lngVal += lngIdx * lngRes * 20;
  }
  return {
    lat: Math.round((-90 + latVal + latRes / 2) * 10000) / 10000,
    lng: Math.round((-180 + lngVal + lngRes / 2) * 10000) / 10000
  };
}

/** Haversine straight-line distance in kilometers (1 decimal place) */
export function haversineKm(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

/** Major Hyderabad / Telangana PIN code centroid mapping */
export const HYDERABAD_PINCODES = {
  "500084": { lat: 17.4710, lng: 78.3535, area: "Kondapur / JV Hills (Warehouse)" },
  "500032": { lat: 17.4401, lng: 78.3489, area: "Gachibowli" },
  "500081": { lat: 17.4483, lng: 78.3915, area: "Madhapur / Hitec City" },
  "500033": { lat: 17.4325, lng: 78.4073, area: "Jubilee Hills" },
  "500034": { lat: 17.4237, lng: 78.4379, area: "Banjara Hills" },
  "500019": { lat: 17.4933, lng: 78.3182, area: "Lingampally / BHEL" },
  "500049": { lat: 17.4947, lng: 78.3546, area: "Miyapur" },
  "500072": { lat: 17.4875, lng: 78.4080, area: "KPHB / Kukatpally" },
  "500018": { lat: 17.4447, lng: 78.4446, area: "SR Nagar / Ameerpet" },
  "500016": { lat: 17.4435, lng: 78.4739, area: "Begumpet" },
  "500003": { lat: 17.4399, lng: 78.4983, area: "Secunderabad" },
  "500001": { lat: 17.3920, lng: 78.4735, area: "Abids" },
  "500002": { lat: 17.3616, lng: 78.4747, area: "Charminar" },
  "500028": { lat: 17.3950, lng: 78.4410, area: "Mehdipatnam" },
  "500068": { lat: 17.3600, lng: 78.5500, area: "LB Nagar" },
  "500082": { lat: 17.4260, lng: 78.4500, area: "Somajiguda" },
  "500070": { lat: 17.3500, lng: 78.5800, area: "Vanasthalipuram" },
  "500090": { lat: 17.5180, lng: 78.3980, area: "Nizampet" },
  "500055": { lat: 17.5020, lng: 78.4350, area: "Quthbullapur / Jeedimetla" },
  "500076": { lat: 17.4400, lng: 78.5400, area: "Nacharam / Mallapur" },
  "500039": { lat: 17.4000, lng: 78.5700, area: "Uppal" },
  "500079": { lat: 17.3480, lng: 78.5300, area: "Karmanghat / Saroornagar" },
  "500097": { lat: 17.2400, lng: 78.4300, area: "Shamshabad / Airport" },
  "501301": { lat: 17.5255, lng: 78.6811, area: "Keesara / Godumakunta" },
  "501401": { lat: 17.6250, lng: 78.4830, area: "Medchal" },
  "501505": { lat: 17.5950, lng: 78.5720, area: "Shamirpet" },
  "501510": { lat: 17.5500, lng: 78.7500, area: "Ghatkesar" },
  "502032": { lat: 17.5300, lng: 78.2600, area: "Patancheru" }
};

/** Resolves coordinates from plus code, pin code, or address */
export function resolveCoordinates({ plusCode, pincode, lat, lng }) {
  if (lat && lng && Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng, source: "coordinates" };
  }
  if (plusCode) {
    const coords = decodePlusCode(plusCode);
    if (coords) return { ...coords, source: "plus_code" };
  }
  if (pincode && HYDERABAD_PINCODES[pincode]) {
    const pin = HYDERABAD_PINCODES[pincode];
    return { lat: pin.lat, lng: pin.lng, area: pin.area, source: "pincode_map" };
  }
  if (pincode && (String(pincode).startsWith("500") || String(pincode).startsWith("501") || String(pincode).startsWith("502"))) {
    // General Greater Hyderabad / suburban fallback: approx 20-25 km from JV Hills
    return { lat: 17.4200, lng: 78.4800, area: "Greater Hyderabad / Suburban", source: "city_fallback" };
  }
  return null;
}

/**
 * Calculates dynamic delivery pricing based on distance (km) and weight (kg).
 * Charges in paise (1 INR = 100 paise).
 */
export function calculateDeliveryEstimate({
  pickup = DEFAULT_WAREHOUSE,
  drop = {},
  weightKg = 1
}) {
  const pickupCoords = resolveCoordinates(pickup) || { lat: DEFAULT_WAREHOUSE.lat, lng: DEFAULT_WAREHOUSE.lng };
  const dropCoords = resolveCoordinates(drop);

  let distanceKm = null;
  if (pickupCoords && dropCoords) {
    distanceKm = haversineKm(pickupCoords.lat, pickupCoords.lng, dropCoords.lat, dropCoords.lng);
  }

  const dropPin = String(drop.pincode || "").trim();
  const isHydMetro = dropPin.startsWith("500") || dropPin.startsWith("501") || dropPin.startsWith("502") || (distanceKm != null && distanceKm <= 40);
  const isTelangana = dropPin.startsWith("50") || (drop.stateCode === "36");

  let deliveryType = "hyperlocal";
  let baseFarePaise = 5000; // Base ₹50 for first 5km
  let distanceFarePaise = 0;
  let weightFarePaise = 0;
  const platformFeePaise = 500; // Nova platform commission: ₹5.00

  const safeWeight = Math.max(0.5, Number(weightKg) || 1);

  if (isHydMetro) {
    deliveryType = "hyperlocal";
    const km = distanceKm != null ? distanceKm : 8; // default 8km if no exact coords
    baseFarePaise = 5000; // ₹50.00 up to 5 km
    if (km > 5) {
      // ₹10 per km beyond 5 km
      distanceFarePaise = Math.round((km - 5) * 10) * 100;
    }
    if (safeWeight > 1) {
      // ₹15 per additional kg beyond 1 kg
      weightFarePaise = Math.round((safeWeight - 1) * 15) * 100;
    }
  } else if (isTelangana) {
    deliveryType = "regional";
    baseFarePaise = 9000; // ₹90.00 base up to 1 kg
    if (safeWeight > 1) {
      weightFarePaise = Math.round((safeWeight - 1) * 25) * 100;
    }
    if (distanceKm != null && distanceKm > 50) {
      distanceFarePaise = Math.min(6000, Math.round((distanceKm - 50) * 0.5) * 100);
    }
  } else {
    deliveryType = "national";
    baseFarePaise = 12000; // ₹120.00 base up to 1 kg
    if (safeWeight > 1) {
      weightFarePaise = Math.round((safeWeight - 1) * 40) * 100;
    }
  }

  const freightChargePaise = baseFarePaise + distanceFarePaise + weightFarePaise;
  const totalChargePaise = freightChargePaise + platformFeePaise;

  return {
    deliveryType,
    distanceKm: distanceKm != null ? distanceKm : (isHydMetro ? 8.0 : isTelangana ? 80.0 : 500.0),
    weightKg: safeWeight,
    baseFarePaise,
    distanceFarePaise,
    weightFarePaise,
    freightChargePaise,
    platformFeePaise,
    totalChargePaise,
    pickupLocation: {
      plusCode: pickup.plusCode || DEFAULT_WAREHOUSE.plusCode,
      pincode: pickup.pincode || DEFAULT_WAREHOUSE.pincode,
      address: pickup.address || DEFAULT_WAREHOUSE.address,
      lat: pickupCoords.lat,
      lng: pickupCoords.lng
    },
    dropLocation: {
      plusCode: drop.plusCode || "",
      pincode: dropPin,
      lat: dropCoords?.lat || null,
      lng: dropCoords?.lng || null,
      area: dropCoords?.area || ""
    }
  };
}
