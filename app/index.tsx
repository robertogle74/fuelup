import { LogBox } from 'react-native';

ErrorUtils.setGlobalHandler((error, isFatal) => {
  console.log("🔥 GLOBAL ERROR:", error);
});

import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, increment, onSnapshot, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Linking,
  Modal,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';

import MapView, { Marker } from 'react-native-maps';
import { auth, db } from '../firebase';
import LoginModal from './LoginModal';
import { getNearbyStations as getSecureNearbyStations } from './services/api.ts';

const IS_DEV = __DEV__;

const Divider = () => (
  <View
    style={{
      height: 1,
      backgroundColor: '#64748b',
      marginVertical: 8
    }}
  />
);

const IS_LIVE = true;
const COLLECTION = IS_LIVE ? "fuel" : "fuel_test";

if (IS_DEV) {
  console.log("🔴 CURRENT DATABASE:", COLLECTION, "IS_LIVE =", IS_LIVE);
}

export default function HomeScreen() {
  console.log("📱 APP STARTED");

  const router = useRouter();

  // Authentication state
  const [user, setUser] = useState(null);
  const [userDisplayName, setUserDisplayName] = useState('');
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [pendingUpdatePlace, setPendingUpdatePlace] = useState(null);
  const [dieselPrice, setDieselPrice] = useState("");
  const [petrolPrice, setPetrolPrice] = useState("");
  const [dieselAvailable, setDieselAvailable] = useState(true);
  const [petrolAvailable, setPetrolAvailable] = useState(true);
  const [focusedInput, setFocusedInput] = useState(null);
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [places, setPlaces] = useState([]);
  const [fuelData, setFuelData] = useState([]);
  const [garageDB, setGarageDB] = useState([]);
  const [userLocation, setUserLocation] = useState(null);
  const [radius, setRadius] = useState('3');
  const [brandFilter, setBrandFilter] = useState("ALL");
  const [sortMode, setSortMode] = useState("DISTANCE");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [priceAction, setPriceAction] = useState(null);

  const radiusTimeout = useRef(null);
  const priceCache = useRef(new Map());

  // Auth listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      if (user) {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists() && userDoc.data().displayName) {
          setUserDisplayName(userDoc.data().displayName);
        }
      } else {
        setUserDisplayName('');
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    try {
      const unsubscribe = loadFuelData();
      loadGarages();
      getUserLocation();
      return () => unsubscribe && unsubscribe();
    } catch (e) {
      console.log("Startup error:", e);
    }
  }, []);

  useEffect(() => {
    if (userLocation) {
      fetchStations(userLocation.latitude, userLocation.longitude);
    }
  }, [radius, userLocation]);

  const loadFuelData = () => {
    try {
      return onSnapshot(collection(db, COLLECTION), (snap) => {
        const data = [];
        snap.forEach(d => data.push(d.data()));

        setFuelData(prevData => {
          if (JSON.stringify(prevData) === JSON.stringify(data)) {
            return prevData;
          }
          return data;
        });
      }, (error) => {
        console.log("❌ Firestore snapshot error:", error);
      });
    } catch (error) {
      console.log("❌ Firestore setup error:", error);
      return () => { };
    }
  };

  const loadGarages = async () => {
    const snap = await getDocs(collection(db, "garages"));
    const data = [];
    snap.forEach(d => data.push(d.data()));
    setGarageDB(data);
  };

  const resetFilters = () => {
    setBrandFilter("ALL");
  };

  const getUserLocation = async () => {
    try {
      console.log("📍 Requesting location permission...");

      let { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== 'granted') {
        console.log("❌ Location permission denied");
        return;
      }

      console.log("📍 Getting current position...");

      let loc = await Location.getCurrentPositionAsync({});

      if (!loc || !loc.coords) {
        console.log("❌ Invalid location response");
        return;
      }

      console.log("✅ Location:", loc.coords);

      setUserLocation(loc.coords);

    } catch (error) {
      console.log("❌ Location error:", error);
    }
  };

  const handleLoginSuccess = async (loggedInUser) => {
    setUser(loggedInUser);
    const userDoc = await getDoc(doc(db, 'users', loggedInUser.uid));
    if (userDoc.exists() && userDoc.data().displayName) {
      setUserDisplayName(userDoc.data().displayName);
    }
    if (pendingUpdatePlace) {
      const d = getLatest(pendingUpdatePlace, "diesel");
      const p = getLatest(pendingUpdatePlace, "petrol");
      setSelectedPlace(pendingUpdatePlace);
      setDieselPrice(d && d.price !== undefined ? d.price.toFixed(2) : "");
      setPetrolPrice(p && p.price !== undefined ? p.price.toFixed(2) : "");
      setDieselAvailable(d ? d.available : true);
      setPetrolAvailable(p ? p.available : true);
      setShowModal(true);
      setPendingUpdatePlace(null);
    }
  };

  const getRegionFromCoords = (lat, lng) => {
    const coastalAreas = [
      { minLat: -34.5, maxLat: -33.5, minLng: 18.0, maxLng: 19.0 },
      { minLat: -30.0, maxLat: -29.5, minLng: 30.5, maxLng: 31.5 },
      { minLat: -34.2, maxLat: -33.8, minLng: 25.4, maxLng: 25.8 },
      { minLat: -33.2, maxLat: -32.8, minLng: 27.7, maxLng: 28.1 },
      { minLat: -34.3, maxLat: -34.0, minLng: 21.9, maxLng: 22.3 },
      { minLat: -28.8, maxLat: -28.6, minLng: 32.0, maxLng: 32.2 },
    ];

    for (const area of coastalAreas) {
      if (lat >= area.minLat && lat <= area.maxLat &&
        lng >= area.minLng && lng <= area.maxLng) {
        return 'coastal';
      }
    }
    if (lng < 24) {
      return 'coastal';
    }
    return 'inland';
  };

  const syncGaragesWithDB = async (googlePlaces) => {
    if (!googlePlaces?.length) return;

    try {
      const settingsDoc = await getDoc(doc(db, 'admin_settings', 'fuel_prices'));
      if (!settingsDoc.exists()) {
        console.log("❌ No admin settings found");
        return;
      }
      const adminSettings = settingsDoc.data();

      const placeIds = googlePlaces.map(p => p.place_id).filter(id => id);

      const garagePromises = placeIds.map(placeId =>
        getDoc(doc(db, "garages", placeId)).catch(() => null)
      );
      const garageResults = await Promise.all(garagePromises);

      const fuelPromises = [];
      placeIds.forEach(placeId => {
        fuelPromises.push(
          getDoc(doc(db, COLLECTION, `${placeId}_diesel`)).catch(() => null),
          getDoc(doc(db, COLLECTION, `${placeId}_petrol`)).catch(() => null)
        );
      });
      const fuelResults = await Promise.all(fuelPromises);

      const existingGarages = new Map();
      garageResults.forEach((docResult, index) => {
        if (docResult?.exists()) {
          existingGarages.set(placeIds[index], docResult.data());
        }
      });

      const existingFuel = new Map();
      let fuelIndex = 0;
      placeIds.forEach(placeId => {
        const dieselDoc = fuelResults[fuelIndex++];
        const petrolDoc = fuelResults[fuelIndex++];
        if (dieselDoc?.exists()) existingFuel.set(`${placeId}_diesel`, dieselDoc.data());
        if (petrolDoc?.exists()) existingFuel.set(`${placeId}_petrol`, petrolDoc.data());
      });

      const batch = writeBatch(db);
      let batchCount = 0;
      let updates = 0;

      for (const place of googlePlaces) {
        const placeId = place.place_id;
        if (!placeId) continue;

        const cacheKey = `${placeId}_${COLLECTION}`;
        const lastCheck = priceCache.current.get(cacheKey);
        if (lastCheck && (Date.now() - lastCheck) < 3600000) {
          continue;
        }
        priceCache.current.set(cacheKey, Date.now());

        const lat = place.geometry.location.lat;
        const lng = place.geometry.location.lng;
        const region = getRegionFromCoords(lat, lng);

        const garageData = {
          place_id: placeId,
          name: place.name,
          lat: lat,
          lng: lng,
          region: region,
          lastSeen: new Date()
        };

        const existingGarage = existingGarages.get(placeId);
        if (!existingGarage) {
          batch.set(doc(db, "garages", placeId), { ...garageData, created: new Date() });
          batchCount++;
          updates++;
        } else if (existingGarage.region !== region) {
          batch.set(doc(db, "garages", placeId), garageData, { merge: true });
          batchCount++;
          updates++;
        }

        const dieselId = `${placeId}_diesel`;
        const petrolId = `${placeId}_petrol`;
        const existingDiesel = existingFuel.get(dieselId);
        const existingPetrol = existingFuel.get(petrolId);

        const needsDiesel = !existingDiesel || existingDiesel.price <= 0;
        const needsPetrol = !existingPetrol || existingPetrol.price <= 0;

        if (needsDiesel || needsPetrol) {
          const petrolPrice = region === 'inland' ? adminSettings.inland_petrol : adminSettings.coastal_petrol;
          const dieselPrice = region === 'inland' ? adminSettings.inland_diesel : adminSettings.coastal_diesel;

          if (needsDiesel && dieselPrice) {
            batch.set(doc(db, COLLECTION, dieselId), {
              name: place.name,
              place_id: placeId,
              fuelType: "diesel",
              price: dieselPrice,
              available: true,
              timestamp: new Date(),
              updatedBy: "system",
              updatedByDisplayName: `Official Rate (${region})`
            });
            batchCount++;
          }

          if (needsPetrol && petrolPrice) {
            batch.set(doc(db, COLLECTION, petrolId), {
              name: place.name,
              place_id: placeId,
              fuelType: "petrol",
              price: petrolPrice,
              available: true,
              timestamp: new Date(),
              updatedBy: "system",
              updatedByDisplayName: `Official Rate (${region})`
            });
            batchCount++;
          }
        }
      }

      if (batchCount > 0) {
        await batch.commit();
        console.log(`✅ Synced ${updates} garages, ${batchCount - updates} fuel prices`);
      }

    } catch (err) {
      console.log("❌ Sync error:", err);
    }
  };

  const fetchStations = async (lat, lng) => {
    setLoading(true);
    const radiusMeters = parseFloat(radius) * 1000;

    try {
      const stations = await getSecureNearbyStations(lat, lng, radiusMeters);

      if (!stations || !Array.isArray(stations)) {
        console.log("❌ Invalid stations response:", stations);
        setPlaces([]);
        setLoading(false);
        return;
      }

      console.log("🔍 Found", stations.length, "garages");

      setPlaces(stations);

      syncGaragesWithDB(stations).catch(err => {
        console.log("⚠️ Background sync error:", err);
      });

    } catch (e) {
      console.log("❌ Error fetching stations:", e);
    }

    setLoading(false);
  };

  const getDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const getBrandFromName = (name = "") => {
    const lower = name.toLowerCase();
    if (lower.includes("shell")) return "Shell";
    if (lower.includes("bp")) return "BP";
    if (lower.includes("engen")) return "Engen";
    if (lower.includes("total")) return "Total";
    if (lower.includes("sasol")) return "Sasol";
    if (lower.includes("caltex")) return "Caltex";
    if (lower.includes("astron")) return "Astron";
    return "Other";
  };

  const getLatest = useCallback((place, type) => {
    if (!place || !fuelData || !Array.isArray(fuelData)) return null;
    const items = fuelData.filter(f => f?.fuelType === type && f?.place_id === place?.place_id);
    if (!items.length) return null;
    let latest = items[0];
    for (let i = 1; i < items.length; i++) {
      if (new Date(items[i].timestamp) > new Date(latest.timestamp)) {
        latest = items[i];
      }
    }
    return latest;
  }, [fuelData]);

  const getAvailabilityStatus = (d, p) => {
    if (d?.available === true || p?.available === true) return "AVAILABLE";
    if (d || p) return "NOT_AVAILABLE";
    return "UNKNOWN";
  };

  const getAvailabilityScore = (status) => {
    if (status === "AVAILABLE") return 0;
    if (status === "UNKNOWN") return 1;
    return 2;
  };

  const getTimeAgo = (timestamp) => {
    if (!timestamp) return "Never";
    let past = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
    if (isNaN(past.getTime())) return "Never";
    const diff = Math.floor((new Date() - past) / 1000);
    if (diff < 60) return "Just now";
    if (diff < 3600) return `${Math.floor(diff / 60)} mins ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} hrs ago`;
    return `${Math.floor(diff / 86400)} days ago`;
  };

  const validatePrice = (price, fuelType) => {
    const numPrice = parseFloat(price);
    if (isNaN(numPrice)) {
      return { valid: false, message: 'Please enter a valid number' };
    }
    const minPrice = 15;
    const maxPrice = 40;
    if (numPrice < minPrice) {
      return { valid: false, message: `Price seems too low (min R${minPrice}). Please check and try again.` };
    }
    if (numPrice > maxPrice) {
      return { valid: false, message: `Price seems too high (max R${maxPrice}). Please check and try again.` };
    }
    if (price.includes('.') && price.split('.')[1]?.length > 2) {
      return { valid: false, message: 'Price should have at most 2 decimal places' };
    }
    return { valid: true, message: '' };
  };

  const mergedPlaces = useMemo(() => {
    const map = new Map();
    places.forEach(p => {
      map.set(p.place_id, p);
    });
    garageDB.forEach(g => {
      if (!map.has(g.place_id)) {
        map.set(g.place_id, {
          place_id: g.place_id,
          name: g.name,
          geometry: {
            location: {
              lat: g.lat,
              lng: g.lng
            }
          },
          isFromDB: true
        });
      }
    });
    return Array.from(map.values());
  }, [places, garageDB]);

  const sortedPlaces = useMemo(() => {
    if (!userLocation) return [];
    return mergedPlaces
      .map(p => {
        const lat = p?.geometry?.location?.lat;
        const lng = p?.geometry?.location?.lng;
        if (!lat || !lng) {
          return { ...p, distance: NaN };
        }
        return {
          ...p,
          distance: getDistance(userLocation.latitude, userLocation.longitude, lat, lng)
        };
      })
      .filter(p => !isNaN(p.distance))
      .filter(p => p.distance <= parseFloat(radius))
      .sort((a, b) => a.distance - b.distance);
  }, [mergedPlaces, userLocation, radius]);

  const filteredPlaces = useMemo(() => {
    return sortedPlaces.filter(place => {
      if (brandFilter === "ALL") return true;
      return getBrandFromName(place.name) === brandFilter;
    });
  }, [sortedPlaces, brandFilter]);

  const finalPlaces = useMemo(() => {
    return [...filteredPlaces].sort((a, b) => {
      if (sortMode === "DISTANCE") {
        return a.distance - b.distance;
      }

      const dA = getLatest(a, "diesel");
      const pA = getLatest(a, "petrol");
      const dB = getLatest(b, "diesel");
      const pB = getLatest(b, "petrol");

      if (sortMode === "CHEAPEST_DIESEL") {
        const priceA = dA && dA.available && dA.price > 0 ? dA.price : Infinity;
        const priceB = dB && dB.available && dB.price > 0 ? dB.price : Infinity;

        if (priceA !== Infinity && priceB !== Infinity) {
          return priceA - priceB;
        }
        if (priceA !== Infinity) return -1;
        if (priceB !== Infinity) return 1;
        return a.distance - b.distance;
      }

      if (sortMode === "CHEAPEST_PETROL") {
        const priceA = pA && pA.available && pA.price > 0 ? pA.price : Infinity;
        const priceB = pB && pB.available && pB.price > 0 ? pB.price : Infinity;

        if (priceA !== Infinity && priceB !== Infinity) {
          return priceA - priceB;
        }
        if (priceA !== Infinity) return -1;
        if (priceB !== Infinity) return 1;
        return a.distance - b.distance;
      }

      return a.distance - b.distance;
    });
  }, [filteredPlaces, sortMode, getLatest]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0B0F1A' }}>
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={true}
        contentContainerStyle={{ paddingBottom: 60 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              if (userLocation) {
                await fetchStations(userLocation.latitude, userLocation.longitude);
              }
              setRefreshing(false);
            }}
          />
        }
      >
        <View style={{ padding: 20 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: '#15803d', fontSize: 28 }}>FuelUp</Text>
            <TouchableOpacity
              onPress={() => {
                if (user) {
                  router.push('/ProfileScreen');
                } else {
                  setShowLoginModal(true);
                }
              }}
              style={{
                backgroundColor: user ? '#15803d' : '#64748b',
                padding: 8,
                paddingHorizontal: 12,
                borderRadius: 8,
              }}
            >
              <Text style={{ color: 'white', fontSize: 14 }}>
                {user ? '👤 Profile' : 'Sign In'}
              </Text>
            </TouchableOpacity>
          </View>

          {user && (
            <>
              <Text style={{ color: '#15803d', fontSize: 12, marginTop: 5 }}>
                ✓ Signed in as {userDisplayName}
              </Text>
              <TouchableOpacity
                onPress={async () => {
                  await auth.signOut();
                  setUser(null);
                  setUserDisplayName('');
                  Alert.alert('Signed Out', 'You have been signed out');
                }}
                style={{
                  backgroundColor: '#b91c1c',
                  padding: 6,
                  paddingHorizontal: 12,
                  borderRadius: 6,
                  marginTop: 5,
                  alignSelf: 'flex-start',
                }}
              >
                <Text style={{ color: 'white', fontSize: 12 }}>Sign Out</Text>
              </TouchableOpacity>
            </>
          )}

          {__DEV__ && (
            <Text style={{ color: '#ffaa00', fontSize: 12, marginTop: 5 }}>
              Database: {COLLECTION} {IS_LIVE ? "(LIVE)" : "(TEST)"}
            </Text>
          )}

          <Text style={{ color: 'white', marginTop: 15 }}>Choose Radius (km):</Text>
          <TextInput
            value={radius}
            onFocus={() => setFocusedInput('radius')}
            onBlur={() => setFocusedInput(null)}
            onChangeText={(text) => {
              setRadius(text);
              if (radiusTimeout.current) {
                clearTimeout(radiusTimeout.current);
              }
              radiusTimeout.current = setTimeout(() => {
                resetFilters();
              }, 500);
            }}
            keyboardType="numeric"
            style={{
              backgroundColor: '#1A1F2E',
              color: 'white',
              padding: 10,
              borderRadius: 8,
              marginTop: 5,
              borderWidth: 2,
              borderColor: focusedInput === 'radius' ? '#15803d' : '#1A1F2E'
            }}
          />

          <TouchableOpacity
            onPress={() => setShowMap(true)}
            style={{ backgroundColor: '#7c3aed', padding: 12, borderRadius: 8, marginTop: 10 }}
          >
            <Text style={{ color: 'white', textAlign: 'center' }}>PICK LOCATION ON MAP</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={async () => {
              resetFilters();
              await getUserLocation();
            }}
            style={{ backgroundColor: '#0d9488', padding: 12, borderRadius: 8, marginTop: 10 }}
          >
            <Text style={{ color: 'white', textAlign: 'center' }}>USE MY LOCATION</Text>
          </TouchableOpacity>

          <Divider />

          {loading && (
            <View style={{ padding: 20, alignItems: 'center' }}>
              <ActivityIndicator size="large" color="#15803d" />
              <Text style={{ color: '#94a3b8', marginTop: 10 }}>Finding nearby garages...</Text>
            </View>
          )}

          <View style={{ marginTop: 10 }}>
            <Text style={{ color: '#94a3b8', marginTop: 5, marginBottom: 5 }}>Garage Brand</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 }}>
              {[
                "ALL",
                ...Array.from(new Set(sortedPlaces.map(p => getBrandFromName(p.name))))
              ].map((brand) => (
                <TouchableOpacity
                  key={brand}
                  onPress={() => setBrandFilter(brand)}
                  style={{
                    backgroundColor: brandFilter === brand ? '#15803d' : '#1A1F2E',
                    paddingVertical: 6,
                    paddingHorizontal: 10,
                    margin: 4,
                    borderRadius: 20
                  }}
                >
                  <Text style={{ color: 'white' }}>{brand}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Divider />

            <Text style={{ color: '#94a3b8', marginTop: 15, marginBottom: 5 }}>Sort By</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 }}>
              <TouchableOpacity
                onPress={() => setSortMode("DISTANCE")}
                style={{
                  backgroundColor: sortMode === "DISTANCE" ? '#15803d' : '#1A1F2E',
                  padding: 8,
                  marginRight: 5,
                  marginBottom: 5,
                  borderRadius: 5,
                }}
              >
                <Text style={{ color: 'white' }}>📍 Closest</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setSortMode("CHEAPEST_DIESEL")}
                style={{
                  backgroundColor: sortMode === "CHEAPEST_DIESEL" ? '#15803d' : '#1A1F2E',
                  padding: 8,
                  marginRight: 5,
                  marginBottom: 5,
                  borderRadius: 5,
                }}
              >
                <Text style={{ color: 'white' }}>⛽ Cheapest Diesel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setSortMode("CHEAPEST_PETROL")}
                style={{
                  backgroundColor: sortMode === "CHEAPEST_PETROL" ? '#15803d' : '#1A1F2E',
                  padding: 8,
                  marginRight: 5,
                  marginBottom: 5,
                  borderRadius: 5,
                }}
              >
                <Text style={{ color: 'white' }}>⛽ Cheapest Petrol</Text>
              </TouchableOpacity>
            </View>
            <Divider />
          </View>

          {finalPlaces.map((place, i) => {
            const d = getLatest(place, "diesel");
            const p = getLatest(place, "petrol");

            return (
              <View key={place.place_id || i} style={{
                marginTop: 15,
                backgroundColor: '#1A1F2E',
                padding: 15,
                borderRadius: 10
              }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <Text style={{ color: 'white', fontWeight: 'bold', flex: 1, fontSize: 16 }}>
                    {place.name}
                  </Text>
                  <Text style={{ color: '#15803d', fontSize: 14 }}>
                    {isNaN(place.distance) ? "—" : `${place.distance.toFixed(2)} km`}
                  </Text>
                </View>

                <View style={{ marginBottom: 8 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: 'white' }}>
                      Diesel: {d ? d.price > 0 ? `R${d.price.toFixed(2)}` : "No price yet" : "No data"}
                    </Text>
                    <Text style={{ color: !d ? '#facc15' : d.available ? '#15803d' : '#b91c1c' }}>
                      {!d ? "No data yet" : d.available ? "Available" : "Not Available"}
                    </Text>
                  </View>
                  <Text style={{ color: '#94a3b8', fontSize: 12 }}>
                    Updated: {d ? getTimeAgo(d.timestamp) : "Never"}
                    {d?.updatedByDisplayName && ` by ${d.updatedByDisplayName}`}
                  </Text>
                </View>

                <View style={{ marginBottom: 12 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: 'white' }}>
                      Petrol: {p ? p.price > 0 ? `R${p.price.toFixed(2)}` : "No price yet" : "No data"}
                    </Text>
                    <Text style={{ color: !p ? '#facc15' : p.available ? '#15803d' : '#b91c1c' }}>
                      {!p ? "No data yet" : p.available ? "Available" : "Not Available"}
                    </Text>
                  </View>
                  <Text style={{ color: '#94a3b8', fontSize: 12 }}>
                    Updated: {p ? getTimeAgo(p.timestamp) : "Never"}
                    {p?.updatedByDisplayName && ` by ${p.updatedByDisplayName}`}
                  </Text>
                </View>

                <View style={{ flexDirection: 'column', gap: 10 }}>
                  {/* NAVIGATE button - full width */}
                  <TouchableOpacity
                    onPress={() => {
                      const lat = place.geometry.location.lat;
                      const lng = place.geometry.location.lng;
                      Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`);
                    }}
                    style={{ backgroundColor: '#2196F3', padding: 12, borderRadius: 8 }}
                  >
                    <Text style={{ color: 'white', textAlign: 'center', fontWeight: '600' }}>🗺️ NAVIGATE</Text>
                  </TouchableOpacity>

                  {/* Two buttons row for Submit and Confirm */}
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <TouchableOpacity
                      onPress={() => {
                        if (user) {
                          setPriceAction("submit");
                          const d = getLatest(place, "diesel");
                          const p = getLatest(place, "petrol");
                          setSelectedPlace(place);
                          setDieselPrice(d && d.price !== undefined ? d.price.toFixed(2) : "");
                          setPetrolPrice(p && p.price !== undefined ? p.price.toFixed(2) : "");
                          setDieselAvailable(d ? d.available : true);
                          setPetrolAvailable(p ? p.available : true);
                          setShowModal(true);
                        } else {
                          setPendingUpdatePlace(place);
                          setShowLoginModal(true);
                        }
                      }}
                      style={{ flex: 1, backgroundColor: '#f59e0b', padding: 12, borderRadius: 8 }}
                    >
                      <Text style={{ color: 'white', textAlign: 'center', fontWeight: '600' }}>📝 Submit Price</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => {
                        if (user) {
                          setPriceAction("confirm");
                          const d = getLatest(place, "diesel");
                          const p = getLatest(place, "petrol");
                          setSelectedPlace(place);
                          setDieselPrice(d && d.price !== undefined ? d.price.toFixed(2) : "");
                          setPetrolPrice(p && p.price !== undefined ? p.price.toFixed(2) : "");
                          setDieselAvailable(d ? d.available : true);
                          setPetrolAvailable(p ? p.available : true);
                          setShowModal(true);
                        } else {
                          setPendingUpdatePlace(place);
                          setShowLoginModal(true);
                        }
                      }}
                      style={{ flex: 1, backgroundColor: '#10b981', padding: 12, borderRadius: 8 }}
                    >
                      <Text style={{ color: 'white', textAlign: 'center', fontWeight: '600' }}>✓ Confirm Price</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            );
          })}

          <View style={{ height: 70 }} />
        </View>

        {/* UPDATE MODAL */}
        {showModal && (
          <Modal animationType="slide" transparent>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' }}>
              <TouchableOpacity
                activeOpacity={1}
                onPress={() => Keyboard.dismiss()}
                style={{ position: 'absolute', width: '100%', height: '100%' }}
              />
              <View style={{ backgroundColor: '#1A1F2E', padding: 20, borderRadius: 10, width: '85%' }}>
                <Text style={{ color: 'white', fontSize: 18 }}>
                  {priceAction === "submit" ? "📝 Submit New Price" : "✓ Confirm Existing Price"}
                </Text>
                <Text style={{ color: '#15803d', marginTop: 10 }}>{selectedPlace?.name}</Text>

                <Text style={{ color: '#94a3b8', marginTop: 20 }}>Diesel</Text>
                <TextInput
                  value={dieselPrice}
                  onChangeText={(text) => {
                    let cleaned = text.replace(/[^0-9.]/g, '');
                    const parts = cleaned.split('.');
                    if (parts.length > 2) {
                      cleaned = parts[0] + '.' + parts.slice(1).join('');
                    }
                    setDieselPrice(cleaned);
                  }}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor="#64748b"
                  style={{ backgroundColor: '#0B0F1A', color: 'white', padding: 10, borderRadius: 5 }}
                />
                <TouchableOpacity
                  onPress={() => setDieselAvailable(!dieselAvailable)}
                  style={{ backgroundColor: dieselAvailable ? '#15803d' : '#b91c1c', padding: 10, marginTop: 8, borderRadius: 5 }}
                >
                  <Text style={{ color: 'white', textAlign: 'center' }}>
                    {dieselAvailable ? "✓ Diesel Available" : "✗ Diesel Not Available"} (Tap to change)
                  </Text>
                </TouchableOpacity>
                <View style={{ height: 1, backgroundColor: '#cad5e3', marginTop: 15 }} />

                <Text style={{ color: '#94a3b8', marginTop: 20 }}>Petrol</Text>
                <TextInput
                  value={petrolPrice}
                  onChangeText={(text) => {
                    let cleaned = text.replace(/[^0-9.]/g, '');
                    const parts = cleaned.split('.');
                    if (parts.length > 2) {
                      cleaned = parts[0] + '.' + parts.slice(1).join('');
                    }
                    setPetrolPrice(cleaned);
                  }}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor="#64748b"
                  style={{ backgroundColor: '#0B0F1A', color: 'white', padding: 10, borderRadius: 5 }}
                />
                <TouchableOpacity
                  onPress={() => setPetrolAvailable(!petrolAvailable)}
                  style={{ backgroundColor: petrolAvailable ? '#15803d' : '#b91c1c', padding: 10, marginTop: 8, borderRadius: 5 }}
                >
                  <Text style={{ color: 'white', textAlign: 'center' }}>
                    {petrolAvailable ? "✓ Petrol Available" : "✗ Petrol Not Available"} (Tap to change)
                  </Text>
                </TouchableOpacity>

                <View style={{ height: 1, backgroundColor: '#cad5e3', marginTop: 15, marginBottom: 10 }} />

                <TouchableOpacity
                  onPress={async () => {
                    if (!selectedPlace) {
                      Alert.alert("Error", "No place selected");
                      return;
                    }

                    if (dieselPrice && dieselPrice !== "") {
                      const dieselValidation = validatePrice(dieselPrice, 'diesel');
                      if (!dieselValidation.valid) {
                        Alert.alert('Invalid Diesel Price', dieselValidation.message);
                        return;
                      }
                    }

                    if (petrolPrice && petrolPrice !== "") {
                      const petrolValidation = validatePrice(petrolPrice, 'petrol');
                      if (!petrolValidation.valid) {
                        Alert.alert('Invalid Petrol Price', petrolValidation.message);
                        return;
                      }
                    }

                    const dieselId = `${selectedPlace.place_id}_diesel`;
                    const petrolId = `${selectedPlace.place_id}_petrol`;

                    try {
                      // Get existing prices to track changes
                      const existingDieselDoc = await getDoc(doc(db, COLLECTION, dieselId));
                      const existingPetrolDoc = await getDoc(doc(db, COLLECTION, petrolId));

                      const now = new Date();

                      // Prepare diesel data with action tracking
                      const dieselData = {
                        name: selectedPlace.name,
                        place_id: selectedPlace.place_id,
                        fuelType: "diesel",
                        price: parseFloat(dieselPrice || "0"),
                        available: dieselAvailable,
                        timestamp: now,
                        updatedBy: user?.uid,
                        updatedByDisplayName: userDisplayName,
                        action: priceAction, // "submit" or "confirm"
                      };

                      // If price changed, save previous price
                      if (existingDieselDoc.exists() && existingDieselDoc.data().price !== parseFloat(dieselPrice || "0")) {
                        dieselData.previousPrice = existingDieselDoc.data().price;
                        dieselData.previousUpdater = existingDieselDoc.data().updatedByDisplayName;
                      }

                      // Prepare petrol data with action tracking
                      const petrolData = {
                        name: selectedPlace.name,
                        place_id: selectedPlace.place_id,
                        fuelType: "petrol",
                        price: parseFloat(petrolPrice || "0"),
                        available: petrolAvailable,
                        timestamp: now,
                        updatedBy: user?.uid,
                        updatedByDisplayName: userDisplayName,
                        action: priceAction, // "submit" or "confirm"
                      };

                      // If price changed, save previous price
                      if (existingPetrolDoc.exists() && existingPetrolDoc.data().price !== parseFloat(petrolPrice || "0")) {
                        petrolData.previousPrice = existingPetrolDoc.data().price;
                        petrolData.previousUpdater = existingPetrolDoc.data().updatedByDisplayName;
                      }

                      // Save to Firestore
                      await setDoc(doc(db, COLLECTION, dieselId), dieselData, { merge: true });
                      await setDoc(doc(db, COLLECTION, petrolId), petrolData, { merge: true });

                      // Update user's stats
                      if (user) {
                        await updateDoc(doc(db, 'users', user.uid), {
                          totalUpdates: increment(1),
                          lastUpdateAction: priceAction,
                          lastUpdateTimestamp: now
                        });
                      }

                      // Different success message based on action
                      const successMessage = priceAction === "submit"
                        ? "Price submitted successfully! It will be reviewed by admins."
                        : "Price confirmed successfully! Thank you for your contribution.";

                      setShowModal(false);
                      Alert.alert("Success", successMessage);

                      // Reset price action
                      setPriceAction(null);

                    } catch (error) {
                      Alert.alert("Error", "Failed to save: " + error.message);
                    }
                  }}
                  style={{
                    backgroundColor: priceAction === "submit" ? '#f59e0b' : '#10b981',
                    padding: 12,
                    marginTop: 20,
                    borderRadius: 5
                  }}
                >
                  <Text style={{ color: 'white', textAlign: 'center', fontWeight: 'bold' }}>
                    {priceAction === "submit" ? "📝 SUBMIT PRICE" : "✓ CONFIRM PRICE"}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => {
                    setShowModal(false);
                    setPriceAction(null); // ← ADD THIS LINE
                  }}
                  style={{ backgroundColor: '#b91c1c', padding: 12, marginTop: 10, borderRadius: 5 }}
                >
                  <Text style={{ color: 'white', textAlign: 'center', fontWeight: 'bold' }}>CANCEL</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        )}

        {/* Login Modal */}
        <LoginModal
          visible={showLoginModal}
          onClose={() => {
            setShowLoginModal(false);
            setPendingUpdatePlace(null);
          }}
          onLoginSuccess={handleLoginSuccess}
        />

        {/* MAP MODAL */}
        {showMap && (
          <Modal animationType="slide" transparent={false} visible={showMap} onRequestClose={() => setShowMap(false)}>
            <View style={{ flex: 1 }}>
              <MapView
                style={{ flex: 1 }}
                initialRegion={{
                  latitude: userLocation?.latitude || -25.7479,
                  longitude: userLocation?.longitude || 28.2293,
                  latitudeDelta: 0.05,
                  longitudeDelta: 0.05,
                }}
                onPress={(e) => {
                  setSelectedLocation(e.nativeEvent.coordinate);
                }}
              >
                {selectedLocation && (
                  <Marker coordinate={selectedLocation} draggable={true} />
                )}
              </MapView>

              <View style={{
                position: 'absolute',
                top: 50,
                left: 20,
                right: 20,
                backgroundColor: 'rgba(0,0,0,0.7)',
                padding: 10,
                borderRadius: 8,
                alignItems: 'center'
              }}>
                <Text style={{ color: 'white', fontSize: 14 }}>📍 Tap on the map to select a location</Text>
                {selectedLocation && (
                  <Text style={{ color: '#15803d', fontSize: 12, marginTop: 5 }}>Location selected ✓</Text>
                )}
              </View>

              <TouchableOpacity
                onPress={() => {
                  if (selectedLocation) {
                    resetFilters();
                    setUserLocation({
                      latitude: selectedLocation.latitude,
                      longitude: selectedLocation.longitude
                    });
                    fetchStations(selectedLocation.latitude, selectedLocation.longitude);
                    setShowMap(false);
                  } else {
                    Alert.alert("No location selected", "Please tap on the map to select a location first");
                  }
                }}
                style={{
                  backgroundColor: selectedLocation ? '#15803d' : '#64748b',
                  padding: 15,
                  margin: 10,
                  borderRadius: 8,
                  position: 'absolute',
                  bottom: 80,
                  left: 20,
                  right: 20
                }}
              >
                <Text style={{ color: 'white', textAlign: 'center', fontWeight: 'bold' }}>
                  {selectedLocation ? "USE THIS LOCATION" : "TAP MAP FIRST"}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  setSelectedLocation(null);
                  setShowMap(false);
                }}
                style={{
                  backgroundColor: '#b91c1c',
                  padding: 15,
                  margin: 10,
                  borderRadius: 8,
                  position: 'absolute',
                  bottom: 20,
                  left: 20,
                  right: 20
                }}
              >
                <Text style={{ color: 'white', textAlign: 'center', fontWeight: 'bold' }}>CANCEL</Text>
              </TouchableOpacity>
            </View>
          </Modal>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
