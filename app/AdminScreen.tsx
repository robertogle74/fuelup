import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { auth, db } from '../firebase';

// Add this near the top of AdminScreen.js
const IS_LIVE = true; // Change this to true for production
const COLLECTION = IS_LIVE ? "fuel" : "fuel_test";

// Optional: Add a visual indicator
console.log("🔴 Admin using database:", COLLECTION);

// Determine region based on coordinates
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

export default function AdminScreen() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchEmail, setSearchEmail] = useState('');
  const [updatingPrices, setUpdatingPrices] = useState(false);
  
  // Default prices (April 2026)
  const [inlandPetrol, setInlandPetrol] = useState('23.36');
  const [inlandDiesel, setInlandDiesel] = useState('26.11');
  const [coastalPetrol, setCoastalPetrol] = useState('22.53');
  const [coastalDiesel, setCoastalDiesel] = useState('25.35');

  useEffect(() => {
    loadUsers();
    loadSavedSettings();
  }, []);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const usersSnap = await getDocs(collection(db, 'users'));
      const usersList = [];
      usersSnap.forEach(doc => {
        usersList.push({ 
          id: doc.id, 
          ...doc.data(),
          createdAtDate: doc.data().createdAt?.toDate?.() || new Date()
        });
      });
      usersList.sort((a, b) => b.createdAtDate - a.createdAtDate);
      setUsers(usersList);
    } catch (error) {
      console.error('Error loading users:', error);
      Alert.alert('Error', 'Failed to load users');
    }
    setLoading(false);
  };

  const loadSavedSettings = async () => {
    try {
      const settingsDoc = await getDoc(doc(db, 'admin_settings', 'fuel_prices'));
      if (settingsDoc.exists()) {
        const data = settingsDoc.data();
        if (data.inland_petrol) setInlandPetrol(data.inland_petrol.toString());
        if (data.inland_diesel) setInlandDiesel(data.inland_diesel.toString());
        if (data.coastal_petrol) setCoastalPetrol(data.coastal_petrol.toString());
        if (data.coastal_diesel) setCoastalDiesel(data.coastal_diesel.toString());
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  const updateAllFuelPrices = async () => {
  Alert.alert(
    'Update Official Fuel Prices',
    `This will update ALL garages with new official rates based on their location.\n\n` +
    `Using database: ${COLLECTION}\n\n` +  // 👈 Show which DB
    `Inland garages will get: Petrol R${inlandPetrol}, Diesel R${inlandDiesel}\n` +
    `Coastal garages will get: Petrol R${coastalPetrol}, Diesel R${coastalDiesel}\n\n` +
    `Previous prices will be saved in "Previous Price" field.\n` +
    `User-submitted prices will be preserved and shown as "Previous Price".\n\n` +
    `Continue?`,
    [
      { text: 'Cancel', style: 'cancel' },
      { 
        text: 'Continue', 
        style: 'destructive',
        onPress: async () => {
          setUpdatingPrices(true);
          
          try {
            const garagesSnap = await getDocs(collection(db, 'garages'));
            const garages = [];
            garagesSnap.forEach(doc => {
              garages.push({ id: doc.id, ...doc.data() });
            });
            
            let updatedDiesel = 0;
            let updatedPetrol = 0;
            let inlandCount = 0;
            let coastalCount = 0;
            let errors = 0;
            
            for (const garage of garages) {
              try {
                let region = garage.region;
                if (!region) {
                  region = getRegionFromCoords(garage.lat, garage.lng);
                  await updateDoc(doc(db, 'garages', garage.id), { region });
                }
                
                if (region === 'inland') {
                  inlandCount++;
                } else {
                  coastalCount++;
                }
                
                const petrolPrice = region === 'inland' ? parseFloat(inlandPetrol) : parseFloat(coastalPetrol);
                const dieselPrice = region === 'inland' ? parseFloat(inlandDiesel) : parseFloat(coastalDiesel);
                
                const dieselId = `${garage.place_id}_diesel`;
                const petrolId = `${garage.place_id}_petrol`;
                
                const dieselDoc = await getDoc(doc(db, COLLECTION, dieselId));
                const petrolDoc = await getDoc(doc(db, COLLECTION, petrolId));
                
                // Update Diesel
                if (dieselDoc.exists()) {
                  const currentPrice = dieselDoc.data().price;
                  const currentUpdater = dieselDoc.data().updatedByDisplayName;
                  const currentTimestamp = dieselDoc.data().timestamp;
                  
                  await setDoc(doc(db, COLLECTION, dieselId), {
                    price: dieselPrice,
                    previousPrice: currentPrice,
                    previousUpdater: currentUpdater,
                    previousUpdateDate: currentTimestamp,
                    officialPriceUpdated: new Date(),
                    updatedBy: 'system',
                    updatedByDisplayName: `Official Rate (${region})`,
                    available: true,
                    timestamp: new Date()
                  }, { merge: true });
                } else {
                  await setDoc(doc(db, COLLECTION, dieselId), {
                    name: garage.name,
                    place_id: garage.place_id,
                    fuelType: 'diesel',
                    price: dieselPrice,
                    available: true,
                    timestamp: new Date(),
                    updatedBy: 'system',
                    updatedByDisplayName: `Official Rate (${region})`
                  }, { merge: true });
                }
                updatedDiesel++;
                
                // Update Petrol
                if (petrolDoc.exists()) {
                  const currentPrice = petrolDoc.data().price;
                  const currentUpdater = petrolDoc.data().updatedByDisplayName;
                  const currentTimestamp = petrolDoc.data().timestamp;
                  
                  await setDoc(doc(db, COLLECTION, petrolId), {
                    price: petrolPrice,
                    previousPrice: currentPrice,
                    previousUpdater: currentUpdater,
                    previousUpdateDate: currentTimestamp,
                    officialPriceUpdated: new Date(),
                    updatedBy: 'system',
                    updatedByDisplayName: `Official Rate (${region})`,
                    available: true,
                    timestamp: new Date()
                  }, { merge: true });
                } else {
                  await setDoc(doc(db, COLLECTION, petrolId), {
                    name: garage.name,
                    place_id: garage.place_id,
                    fuelType: 'petrol',
                    price: petrolPrice,
                    available: true,
                    timestamp: new Date(),
                    updatedBy: 'system',
                    updatedByDisplayName: `Official Rate (${region})`
                  }, { merge: true });
                }
                updatedPetrol++;
                
              } catch (err) {
                errors++;
                console.error(`Error updating ${garage.name}:`, err);
              }
            }
            
            await setDoc(doc(db, 'admin_settings', 'fuel_prices'), {
              inland_petrol: parseFloat(inlandPetrol),
              inland_diesel: parseFloat(inlandDiesel),
              coastal_petrol: parseFloat(coastalPetrol),
              coastal_diesel: parseFloat(coastalDiesel),
              lastUpdated: new Date(),
              updatedBy: auth.currentUser?.email,
              updatedByDisplayName: auth.currentUser?.displayName || 'Admin'
            }, { merge: true });
            
            Alert.alert('Update Complete', 
              `Database: ${COLLECTION}\n\n` +  // 👈 Show which DB was updated
              `📍 Inland garages: ${inlandCount}\n` +
              `📍 Coastal garages: ${coastalCount}\n\n` +
              `✅ Diesel updated: ${updatedDiesel}\n` +
              `✅ Petrol updated: ${updatedPetrol}\n\n` +
              `❌ Errors: ${errors}`
            );
          } catch (error) {
            console.error('Update error:', error);
            Alert.alert('Error', 'Failed to update fuel prices');
          } finally {
            setUpdatingPrices(false);
          }
        }
      }
    ]
  );
};

  const resetToDefaultPrices = () => {
    setInlandPetrol('23.36');
    setInlandDiesel('26.11');
    setCoastalPetrol('22.53');
    setCoastalDiesel('25.35');
    Alert.alert('Reset Complete', 'Prices reset to default (April 2026 values)');
  };

  const toggleBlockUser = async (userId, currentBlocked, userEmail) => {
    Alert.alert(
      currentBlocked ? 'Unblock User' : 'Block User',
      currentBlocked 
        ? `Unblock ${userEmail}? They can update prices again.`
        : `Block ${userEmail}? They will no longer be able to update prices.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          style: currentBlocked ? 'default' : 'destructive',
          onPress: async () => {
            try {
              await updateDoc(doc(db, 'users', userId), {
                blocked: !currentBlocked
              });
              loadUsers();
              Alert.alert('Success', currentBlocked ? 'User unblocked' : 'User blocked');
            } catch (error) {
              Alert.alert('Error', 'Failed to update user');
            }
          }
        }
      ]
    );
  };

  const toggleAdmin = async (userId, currentIsAdmin, userEmail) => {
    const currentUser = auth.currentUser;
    if (currentUser?.email === userEmail && currentIsAdmin === true) {
      Alert.alert('Warning', 'You cannot remove your own admin privileges.');
      return;
    }

    Alert.alert(
      currentIsAdmin ? 'Remove Admin' : 'Make Admin',
      currentIsAdmin 
        ? `Remove admin privileges from ${userEmail}?`
        : `Make ${userEmail} an admin?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            try {
              await updateDoc(doc(db, 'users', userId), {
                isAdmin: !currentIsAdmin
              });
              loadUsers();
              Alert.alert('Success', currentIsAdmin ? 'Admin privileges removed' : 'User is now an admin');
            } catch (error) {
              Alert.alert('Error', 'Failed to update admin status');
            }
          }
        }
      ]
    );
  };

  const getTotalUpdates = () => {
    return users.reduce((sum, user) => sum + (user.totalUpdates || 0), 0);
  };

  const getBlockedCount = () => {
    return users.filter(user => user.blocked === true).length;
  };

  const getAdminCount = () => {
    return users.filter(user => user.isAdmin === true).length;
  };

  const filteredUsers = searchEmail
    ? users.filter(u => u.email?.toLowerCase().includes(searchEmail.toLowerCase()))
    : users;

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#15803d" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Admin Panel</Text>
        <Text style={styles.subtitle}>Manage Users & Fuel Prices</Text>
      </View>

      {/* Official Fuel Price Update Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Official Fuel Price Update</Text>
        <Text style={styles.sectionSubtitle}>Update official rates - Garages will get prices based on their location</Text>
        
        {/* Inland Region */}
        <Text style={styles.regionTitle}>🏔️ Inland Region (Gauteng, etc.)</Text>
        <View style={styles.priceRow}>
          <View style={styles.priceInputGroup}>
            <Text style={styles.priceLabel}>Petrol 95 (Regulated)</Text>
            <TextInput
              style={styles.priceInput}
              value={inlandPetrol}
              onChangeText={setInlandPetrol}
              keyboardType="numeric"
              placeholder="0.00"
            />
          </View>
          <View style={styles.priceInputGroup}>
            <Text style={styles.priceLabel}>Diesel 50ppm (Market)</Text>
            <TextInput
              style={styles.priceInput}
              value={inlandDiesel}
              onChangeText={setInlandDiesel}
              keyboardType="numeric"
              placeholder="0.00"
            />
          </View>
        </View>
        
        {/* Coastal Region */}
        <Text style={styles.regionTitle}>🌊 Coastal Region (KZN, WC, etc.)</Text>
        <View style={styles.priceRow}>
          <View style={styles.priceInputGroup}>
            <Text style={styles.priceLabel}>Petrol 95 (Regulated)</Text>
            <TextInput
              style={styles.priceInput}
              value={coastalPetrol}
              onChangeText={setCoastalPetrol}
              keyboardType="numeric"
              placeholder="0.00"
            />
          </View>
          <View style={styles.priceInputGroup}>
            <Text style={styles.priceLabel}>Diesel 50ppm (Market)</Text>
            <TextInput
              style={styles.priceInput}
              value={coastalDiesel}
              onChangeText={setCoastalDiesel}
              keyboardType="numeric"
              placeholder="0.00"
            />
          </View>
        </View>
        
        {/* Action Buttons */}
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.actionButton, styles.resetButton]}
            onPress={resetToDefaultPrices}
          >
            <Text style={styles.actionButtonText}>Reset to Default</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.actionButton, styles.websiteButton]}
            onPress={() => Linking.openURL('https://www.fuelprice.co.za')}
          >
            <Text style={styles.actionButtonText}>🌐 Get Latest Prices</Text>
          </TouchableOpacity>
        </View>
        
        {updatingPrices ? (
          <ActivityIndicator size="large" color="#15803d" style={styles.updatingIndicator} />
        ) : (
          <TouchableOpacity
            style={styles.updateButton}
            onPress={updateAllFuelPrices}
          >
            <Text style={styles.updateButtonText}>Apply Official Prices to All Garages</Text>
          </TouchableOpacity>
        )}
        
        <Text style={styles.note}>
          📌 How it works:\n
          • Automatically detects if garage is Inland or Coastal\n
          • Updates ALL garages with official rates\n
          • Previous prices are saved in "Previous Price" field\n
          • User-submitted prices are preserved as history\n
          • Official rates are updated monthly
        </Text>
      </View>

      {/* Stats Cards */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{users.length}</Text>
          <Text style={styles.statLabel}>Total Users</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{getTotalUpdates()}</Text>
          <Text style={styles.statLabel}>Total Updates</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statNumber, getBlockedCount() > 0 && styles.blockedStat]}>
            {getBlockedCount()}
          </Text>
          <Text style={styles.statLabel}>Blocked</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statNumber, styles.adminStat]}>
            {getAdminCount()}
          </Text>
          <Text style={styles.statLabel}>Admins</Text>
        </View>
      </View>

      {/* Search Input */}
      <TextInput
        style={styles.searchInput}
        placeholder="Search by email..."
        placeholderTextColor="#64748b"
        value={searchEmail}
        onChangeText={setSearchEmail}
      />

      {/* Users List */}
      <FlatList
        data={filteredUsers}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={[styles.userCard, item.blocked && styles.blockedCard]}>
            <View style={styles.userInfo}>
              <View style={styles.userHeader}>
                <Text style={styles.userName}>{item.displayName || 'No name'}</Text>
                {item.isAdmin && (
                  <View style={styles.adminBadge}>
                    <Text style={styles.adminBadgeText}>ADMIN</Text>
                  </View>
                )}
                {item.blocked && (
                  <View style={styles.blockedBadge}>
                    <Text style={styles.blockedBadgeText}>BLOCKED</Text>
                  </View>
                )}
              </View>
              <Text style={styles.userEmail}>{item.email}</Text>
              <View style={styles.userStats}>
                <Text style={styles.userStatText}>
                  📊 Updates: {item.totalUpdates || 0}
                </Text>
                <Text style={styles.userStatText}>
                  📅 Joined: {item.createdAtDate.toLocaleDateString()}
                </Text>
              </View>
            </View>
            <View style={styles.actionButtons}>
              <TouchableOpacity
                style={[styles.adminButton, item.isAdmin && styles.removeAdminButton]}
                onPress={() => toggleAdmin(item.id, item.isAdmin || false, item.email)}
              >
                <Text style={styles.adminButtonText}>
                  {item.isAdmin ? 'Remove Admin' : 'Make Admin'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.blockButton, item.blocked && styles.unblockButton]}
                onPress={() => toggleBlockUser(item.id, item.blocked, item.email)}
              >
                <Text style={styles.blockButtonText}>
                  {item.blocked ? 'Unblock' : 'Block'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No users found</Text>
          </View>
        }
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0F1A', padding: 16 },
  loadingContainer: { flex: 1, backgroundColor: '#0B0F1A', justifyContent: 'center', alignItems: 'center' },
  header: { marginBottom: 20 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#15803d' },
  subtitle: { fontSize: 14, color: '#94a3b8', marginTop: 4 },
  
  section: { backgroundColor: '#1A1F2E', borderRadius: 12, padding: 16, marginBottom: 20 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: 'white', marginBottom: 4 },
  sectionSubtitle: { fontSize: 12, color: '#94a3b8', marginBottom: 16 },
  regionTitle: { fontSize: 14, fontWeight: '600', color: '#15803d', marginTop: 12, marginBottom: 8 },
  priceRow: { flexDirection: 'row', gap: 12, marginBottom: 8 },
  priceInputGroup: { flex: 1 },
  priceLabel: { color: '#94a3b8', fontSize: 12, marginBottom: 4 },
  priceInput: { backgroundColor: '#0B0F1A', color: 'white', padding: 10, borderRadius: 8, fontSize: 16 },
  
  buttonRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginVertical: 12 },
  actionButton: { flex: 1, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6, alignItems: 'center' },
  resetButton: { backgroundColor: '#64748b' },
  websiteButton: { backgroundColor: '#15803d' },
  actionButtonText: { color: 'white', fontSize: 12, fontWeight: '600' },
  
  updateButton: { backgroundColor: '#7c3aed', padding: 14, borderRadius: 8, alignItems: 'center', marginTop: 16 },
  updateButtonText: { color: 'white', fontSize: 16, fontWeight: '600' },
  updatingIndicator: { padding: 20 },
  note: { fontSize: 11, color: '#64748b', marginTop: 12, textAlign: 'center', lineHeight: 16 },
  
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  statCard: { flex: 1, backgroundColor: '#1A1F2E', padding: 12, borderRadius: 10, alignItems: 'center', marginHorizontal: 4 },
  statNumber: { fontSize: 20, fontWeight: 'bold', color: '#15803d' },
  blockedStat: { color: '#b91c1c' },
  adminStat: { color: '#7c3aed' },
  statLabel: { fontSize: 10, color: '#94a3b8', marginTop: 4 },
  
  searchInput: { backgroundColor: '#1A1F2E', color: 'white', padding: 12, borderRadius: 8, marginBottom: 16 },
  
  userCard: { backgroundColor: '#1A1F2E', padding: 16, borderRadius: 12, marginBottom: 12 },
  blockedCard: { backgroundColor: '#2d1a1a', borderLeftWidth: 3, borderLeftColor: '#b91c1c' },
  userInfo: { flex: 1, marginBottom: 12 },
  userHeader: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 },
  userName: { color: 'white', fontSize: 16, fontWeight: '600', marginRight: 8 },
  adminBadge: { backgroundColor: '#7c3aed', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, marginRight: 6 },
  adminBadgeText: { color: 'white', fontSize: 10, fontWeight: 'bold' },
  blockedBadge: { backgroundColor: '#b91c1c', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  blockedBadgeText: { color: 'white', fontSize: 10, fontWeight: 'bold' },
  userEmail: { color: '#94a3b8', fontSize: 12, marginBottom: 6 },
  userStats: { flexDirection: 'row', gap: 12 },
  userStatText: { color: '#64748b', fontSize: 11 },
  
  actionButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  adminButton: { backgroundColor: '#7c3aed', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6 },
  removeAdminButton: { backgroundColor: '#4b5563' },
  adminButtonText: { color: 'white', fontWeight: '600', fontSize: 12 },
  blockButton: { backgroundColor: '#b91c1c', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6 },
  unblockButton: { backgroundColor: '#15803d' },
  blockButtonText: { color: 'white', fontWeight: '600', fontSize: 12 },
  
  emptyContainer: { padding: 40, alignItems: 'center' },
  emptyText: { color: '#64748b', fontSize: 14 },
});
