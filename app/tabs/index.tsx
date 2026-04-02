import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, increment, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
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
import { auth, db } from '../../firebase';
import LoginModal from '../LoginModal';

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

const IS_LIVE = false;
const COLLECTION = IS_LIVE ? "fuel" : "fuel_test";

if (IS_DEV) {
  console.log("🔴 CURRENT DATABASE:", COLLECTION, "IS_LIVE =", IS_LIVE);
}

const API_KEY = "AIzaSyCKN-E8wh4_f8zZ1wmiFcXgJ4VeHBMtAPA";

export default function HomeScreen() {

  const router = useRouter();

  // Authentication state
  const [user, setUser] = useState(null);
  const [userDisplayName, setUserDisplayName] = useState('');
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [pendingUpdatePlace, setPendingUpdatePlace] = useState(null);

  const [fuelFilter, setFuelFilter] = useState("BOTH");
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
  
  const radiusTimeout = useRef(null);

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
    const unsubscribe = loadFuelData();
    loadGarages();
    getNearbyStations();
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (userLocation) {
      fetchStations(userLocation.latitude, userLocation.longitude);
    }
  }, [radius, userLocation]);

  const loadFuelData = () => {
    return onSnapshot(collection(db, COLLECTION), (snap) => {
      const data = [];
      snap.forEach(d => data.push(d.data()));
      setFuelData(prevData => {
        if (JSON.stringify(prevData) === JSON.stringify(data)) {
          return prevData;
        }
        return data;
      });
    });
  };

  const loadGarages = async () => {
    const snap = await getDocs(collection(db, "garages"));
    const data = [];
    snap.forEach(d => data.push(d.data()));
    setGarageDB(data);
  };

  const resetFilters = () => {
    setBrandFilter("ALL");
    setFuelFilter("BOTH");
  };

  const getNearbyStations = async () => {
    let { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;
    let loc = await Location.getCurrentPositionAsync({});
    setUserLocation(loc.coords);
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

// Add this helper function at the top of your index.tsx (after imports)
const getRegionFromCoords = (lat, lng) => {
  // Coastal areas bounding boxes
  const coastalAreas = [
    { minLat: -34.5, maxLat: -33.5, minLng: 18.0, maxLng: 19.0 }, // Cape Town
    { minLat: -30.0, maxLat: -29.5, minLng: 30.5, maxLng: 31.5 }, // Durban
    { minLat: -34.2, maxLat: -33.8, minLng: 25.4, maxLng: 25.8 }, // Gqeberha
    { minLat: -33.2, maxLat: -32.8, minLng: 27.7, maxLng: 28.1 }, // East London
    { minLat: -34.3, maxLat: -34.0, minLng: 21.9, maxLng: 22.3 }, // Mossel Bay
    { minLat: -28.8, maxLat: -28.6, minLng: 32.0, maxLng: 32.2 }, // Richards Bay
  ];
  
  for (const area of coastalAreas) {
    if (lat >= area.minLat && lat <= area.maxLat && 
        lng >= area.minLng && lng <= area.maxLng) {
      return 'coastal';
    }
  }
  
  // Rough approximation: longitudes below 24°E are coastal
  if (lng < 24) {
    return 'coastal';
  }
  
  return 'inland';
};

// Then replace your syncGaragesWithDB function:
const syncGaragesWithDB = async (googlePlaces) => {
  if (!googlePlaces?.length) return;
  
  try {
    // Get admin settings for auto-assigning official prices
    const settingsDoc = await getDoc(doc(db, 'admin_settings', 'fuel_prices'));
    let adminSettings = null;
    if (settingsDoc.exists()) {
      adminSettings = settingsDoc.data();
    }
    
    const snap = await getDocs(collection(db, "garages"));
    const existing = new Map();
    snap.forEach(doc => {
      const data = doc.data();
      existing.set(data.place_id, true);
    });
    
    const promises = [];
    let newCount = 0;
    
    for (const place of googlePlaces) {
      const placeId = place.place_id;
      if (!placeId) continue;
      
      const lat = place.geometry.location.lat;
      const lng = place.geometry.location.lng;
      const region = getRegionFromCoords(lat, lng);
      
      const data = {
        place_id: placeId,
        name: place.name,
        lat: lat,
        lng: lng,
        region: region,
        lastSeen: new Date()
      };
      
      if (!existing.has(placeId)) {
        console.log(`➕ NEW garage: ${place.name} (${region})`);
        promises.push(
          setDoc(doc(db, "garages", placeId), {
            ...data,
            created: new Date()
          })
        );
        newCount++;
        
        // If admin settings exist, auto-assign official prices to new garage
        if (adminSettings) {
          const petrolPrice = region === 'inland' ? adminSettings.inland_petrol : adminSettings.coastal_petrol;
          const dieselPrice = region === 'inland' ? adminSettings.inland_diesel : adminSettings.coastal_diesel;
          
          if (petrolPrice && dieselPrice) {
            const dieselId = `${placeId}_diesel`;
            promises.push(
              setDoc(doc(db, COLLECTION, dieselId), {
                name: place.name,
                place_id: placeId,
                fuelType: "diesel",
                price: dieselPrice,
                available: true,
                timestamp: new Date(),
                updatedBy: "system",
                updatedByDisplayName: `Official Rate (${region})`
              }, { merge: true })
            );
            
            const petrolId = `${placeId}_petrol`;
            promises.push(
              setDoc(doc(db, COLLECTION, petrolId), {
                name: place.name,
                place_id: placeId,
                fuelType: "petrol",
                price: petrolPrice,
                available: true,
                timestamp: new Date(),
                updatedBy: "system",
                updatedByDisplayName: `Official Rate (${region})`
              }, { merge: true })
            );
            
            console.log(`💰 Auto-assigned ${region} prices to new garage: ${place.name}`);
          }
        }
      } else {
        console.log(`🔄 UPDATE garage: ${place.name}`);
        promises.push(
          setDoc(doc(db, "garages", placeId), data, { merge: true })
        );
      }
    }
    
    console.log(`📊 Found ${newCount} new garages to add`);
    
    if (promises.length > 0) {
      console.log("💾 Saving to Firebase...");
      await Promise.all(promises);
      console.log("✅ All garages saved successfully!");
    } else {
      console.log("⚠️ No promises to resolve");
    }
  } catch (err) {
    console.log("❌ Garage sync error:", err);
  }
};

  const fetchStations = async (lat, lng) => {
    setLoading(true);
    const radiusMeters = parseFloat(radius) * 1000;
    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radiusMeters}&type=gas_station&key=${API_KEY}`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      const results = data.results || [];
      setPlaces(results);
      await syncGaragesWithDB(results);
    } catch (e) {
      console.log(e);
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

  // MEMOIZED CALCULATIONS
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

  const fuelFilteredPlaces = useMemo(() => {
    return filteredPlaces.filter(place => {
      const d = getLatest(place, "diesel");
      const p = getLatest(place, "petrol");
      const hasAnyData = d || p;
      if (!hasAnyData) return true;
      if (fuelFilter === "PETROL" && !p) return false;
      if (fuelFilter === "DIESEL" && !d) return false;
      if (fuelFilter === "BOTH" && (!p || !d)) return false;
      return true;
    });
  }, [filteredPlaces, fuelFilter, getLatest]);

  const finalPlaces = useMemo(() => {
    return [...fuelFilteredPlaces].sort((a, b) => {
      if (fuelFilter === "BOTH" || sortMode === "DISTANCE") {
        return a.distance - b.distance;
      }
      const dA = getLatest(a, "diesel");
      const pA = getLatest(a, "petrol");
      const dB = getLatest(b, "diesel");
      const pB = getLatest(b, "petrol");
      const statusA = getAvailabilityStatus(dA, pA);
      const statusB = getAvailabilityStatus(dB, pB);
      const scoreA = getAvailabilityScore(statusA);
      const scoreB = getAvailabilityScore(statusB);
      if (scoreA !== scoreB) return scoreA - scoreB;
      let priceA = Infinity;
      let priceB = Infinity;
      if (fuelFilter === "PETROL") {
        const validA = pA && pA.available && pA.price > 0;
        const validB = pB && pB.available && pB.price > 0;
        if (validA && !validB) return -1;
        if (!validA && validB) return 1;
        priceA = validA ? pA.price : Infinity;
        priceB = validB ? pB.price : Infinity;
      } else if (fuelFilter === "DIESEL") {
        const validA = dA && dA.available && dA.price > 0;
        const validB = dB && dB.available && dB.price > 0;
        if (validA && !validB) return -1;
        if (!validA && validB) return 1;
        priceA = validA ? dA.price : Infinity;
        priceB = validB ? dB.price : Infinity;
      }
      return priceA - priceB;
    });
  }, [fuelFilteredPlaces, fuelFilter, sortMode, getLatest]);

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
          
          <Text style={{ color: '#ffaa00', fontSize: 12, marginTop: 5 }}>
            Database: {COLLECTION} {IS_LIVE ? "(LIVE)" : "(TEST)"}
          </Text>

          <Text style={{ color: 'white', marginTop: 15 }}>Choose Radius:</Text>
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
            onPress={() => {
              resetFilters();
              getNearbyStations();
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
            
            <Text style={{ color: '#94a3b8', marginBottom: 5 }}>Fuel Type</Text>
            <View style={{ flexDirection: 'row', marginTop: 10 }}>
              {["BOTH", "PETROL", "DIESEL"].map(f => (
                <TouchableOpacity
                  key={f}
                  onPress={() => {
                    setFuelFilter(f);
                    if (f === "BOTH") {
                      setSortMode("DISTANCE");
                    }
                  }}
                  style={{
                    backgroundColor: fuelFilter === f ? '#15803d' : '#1A1F2E',
                    padding: 8,
                    marginRight: 5,
                    borderRadius: 5
                  }}
                >
                  <Text style={{ color: 'white' }}>{f === "BOTH" ? "Both" : f}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Divider />
            
            <Text style={{ color: '#94a3b8', marginTop: 15, marginBottom: 5 }}>Sort By</Text>
            <View style={{ flexDirection: 'row', marginTop: 10 }}>
              {["DISTANCE", "CHEAPEST"].map(mode => (
                <TouchableOpacity
                  key={mode}
                  disabled={fuelFilter === "BOTH"}
                  onPress={() => setSortMode(mode)}
                  style={{
                    backgroundColor: fuelFilter === "BOTH"
                      ? '#0f172a'
                      : sortMode === mode
                      ? '#15803d'
                      : '#1A1F2E',
                    padding: 8,
                    marginRight: 5,
                    borderRadius: 5,
                    opacity: fuelFilter === "BOTH" ? 0.3 : 1
                  }}
                >
                  <Text style={{ color: fuelFilter === "BOTH" ? '#475569' : 'white' }}>
                    {mode === "DISTANCE" ? "Closest" : "Cheapest"}
                  </Text>
                </TouchableOpacity>
              ))}
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
  {/* 👇 ADD THIS - Show previous price if exists */}
  {d?.previousPrice && d.previousPrice > 0 && (
    <Text style={{ color: '#64748b', fontSize: 10, marginTop: 2 }}>
      Previous: R{d.previousPrice.toFixed(2)} ({d.previousUpdater || 'Unknown'})
    </Text>
  )}
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

                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
                  <TouchableOpacity
                    onPress={() => {
                      const lat = place.geometry.location.lat;
                      const lng = place.geometry.location.lng;
                      Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`);
                    }}
                    style={{ flex: 1, backgroundColor: '#2196F3', padding: 12, borderRadius: 8 }}
                  >
                    <Text style={{ color: 'white', textAlign: 'center', fontWeight: '600' }}>NAVIGATE</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => {
                      if (user) {
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
                    style={{ flex: 1, backgroundColor: '#f87171', padding: 12, borderRadius: 8 }}
                  >
                    <Text style={{ color: 'white', textAlign: 'center', fontWeight: '600' }}>UPDATE PRICES</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}

          {/* Spacer */}
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
                <Text style={{ color: 'white', fontSize: 18 }}>Update Prices</Text>
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
                <Text style={{ fontSize: 11, color: '#64748b', marginTop: 4, marginBottom: 8 }}>
                  Recommended price: R15 - R40 per liter
                </Text>
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
                <Text style={{ fontSize: 11, color: '#64748b', marginTop: 4, marginBottom: 8 }}>
                  Recommended price: R15 - R40 per liter
                </Text>
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
                      await setDoc(doc(db, COLLECTION, dieselId), {
                        name: selectedPlace.name,
                        place_id: selectedPlace.place_id,
                        fuelType: "diesel",
                        price: parseFloat(dieselPrice || "0"),
                        available: dieselAvailable,
                        timestamp: new Date(),
                        updatedBy: user?.uid,
                        updatedByDisplayName: userDisplayName
                      }, { merge: true });

                      await setDoc(doc(db, COLLECTION, petrolId), {
                        name: selectedPlace.name,
                        place_id: selectedPlace.place_id,
                        fuelType: "petrol",
                        price: parseFloat(petrolPrice || "0"),
                        available: petrolAvailable,
                        timestamp: new Date(),
                        updatedBy: user?.uid,
                        updatedByDisplayName: userDisplayName
                      }, { merge: true });

                      if (user) {
                        await updateDoc(doc(db, 'users', user.uid), {
                          totalUpdates: increment(1)
                        });
                      }

                      setShowModal(false);
                      Alert.alert("Success", "Fuel prices updated successfully!");
                    } catch (error) {
                      Alert.alert("Error", "Failed to save: " + error.message);
                    }
                  }}
                  style={{ backgroundColor: '#15803d', padding: 12, marginTop: 20, borderRadius: 5 }}
                >
                  <Text style={{ color: 'white', textAlign: 'center', fontWeight: 'bold' }}>SAVE & CLOSE</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => {
                    setShowModal(false);
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