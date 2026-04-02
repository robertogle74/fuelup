import { collection, doc, getDocs, updateDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { auth, db } from '../firebase';

export default function AdminScreen() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchEmail, setSearchEmail] = useState('');
  const [currentAdminEmail, setCurrentAdminEmail] = useState('');

  useEffect(() => {
    const user = auth.currentUser;
    if (user) {
      setCurrentAdminEmail(user.email);
    }
    loadUsers();
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
    if (currentAdminEmail === userEmail && currentIsAdmin === true) {
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
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Admin Panel</Text>
        <Text style={styles.subtitle}>Manage Users & Permissions</Text>
      </View>

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

      <TextInput
        style={styles.searchInput}
        placeholder="Search by email..."
        placeholderTextColor="#64748b"
        value={searchEmail}
        onChangeText={setSearchEmail}
      />

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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0F1A', padding: 16 },
  loadingContainer: { flex: 1, backgroundColor: '#0B0F1A', justifyContent: 'center', alignItems: 'center' },
  header: { marginBottom: 20 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#15803d' },
  subtitle: { fontSize: 14, color: '#94a3b8', marginTop: 4 },
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