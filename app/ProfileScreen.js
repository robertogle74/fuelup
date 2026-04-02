import { useRouter } from 'expo-router';
import { EmailAuthProvider, reauthenticateWithCredential, signOut, updatePassword } from 'firebase/auth';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { auth, db } from '../firebase';

export default function ProfileScreen() {
  const router = useRouter();
  
  const [displayName, setDisplayName] = useState('');
  const [originalName, setOriginalName] = useState('');
  const [totalUpdates, setTotalUpdates] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [user, setUser] = useState(null);
  const [isGoogleUser, setIsGoogleUser] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    loadUserData();
  }, []);

  const loadUserData = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    
    setUser(currentUser);
    
    // Check if user signed up with Google
    const providerData = currentUser.providerData;
    const isGoogle = providerData.some(provider => provider.providerId === 'google.com');
    setIsGoogleUser(isGoogle);
    
    const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
    if (userDoc.exists()) {
      const data = userDoc.data();
      setDisplayName(data.displayName || '');
      setOriginalName(data.displayName || '');
      setTotalUpdates(data.totalUpdates || 0);
      setIsAdmin(data.isAdmin === true);
    }
    setLoading(false);
  };

  const handleSave = async () => {
    if (!displayName.trim()) {
      Alert.alert('Error', 'Display name cannot be empty');
      return;
    }
    
    if (displayName === originalName) {
      Alert.alert('No changes', 'Display name is the same');
      return;
    }
    
    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        displayName: displayName.trim(),
        lastActive: new Date()
      });
      setOriginalName(displayName.trim());
      Alert.alert('Success', 'Display name updated');
    } catch (error) {
      Alert.alert('Error', 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword) {
      Alert.alert('Error', 'Please enter both passwords');
      return;
    }
    
    if (newPassword.length < 6) {
      Alert.alert('Error', 'New password must be at least 6 characters');
      return;
    }
    
    setChangingPassword(true);
    try {
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPassword);
      Alert.alert('Success', 'Password changed successfully');
      setShowPasswordChange(false);
      setCurrentPassword('');
      setNewPassword('');
    } catch (error) {
      if (error.code === 'auth/wrong-password') {
        Alert.alert('Error', 'Current password is incorrect');
      } else {
        Alert.alert('Error', 'Failed to change password');
      }
    } finally {
      setChangingPassword(false);
    }
  };

  const handleSignOut = async () => {
    Alert.alert('Sign Out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: async () => {
        await signOut(auth);
        router.replace('/');
      }}
    ]);
  };

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
        <Text style={styles.title}>My Profile</Text>
      </View>

      <View style={styles.statsCard}>
        <Text style={styles.statsNumber}>{totalUpdates}</Text>
        <Text style={styles.statsLabel}>Total Price Updates</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Display Name</Text>
        <Text style={styles.sectionSubtitle}>This name appears next to your price updates</Text>
        <TextInput
          style={styles.input}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Enter display name"
          placeholderTextColor="#64748b"
          maxLength={20}
        />
        <Text style={styles.hint}>{displayName.length}/20 characters</Text>
        <TouchableOpacity
          style={[styles.saveButton, saving && styles.buttonDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Save Changes'}</Text>
        </TouchableOpacity>
      </View>

      {!isGoogleUser && (
        <>
          {!showPasswordChange ? (
            <TouchableOpacity
              style={styles.changePasswordButton}
              onPress={() => setShowPasswordChange(true)}
            >
              <Text style={styles.changePasswordText}>Change Password</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Change Password</Text>
              <TextInput
                style={styles.input}
                placeholder="Current Password"
                placeholderTextColor="#64748b"
                value={currentPassword}
                onChangeText={setCurrentPassword}
                secureTextEntry
              />
              <TextInput
                style={styles.input}
                placeholder="New Password (min 6 characters)"
                placeholderTextColor="#64748b"
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
              />
              <TouchableOpacity
                style={[styles.saveButton, changingPassword && styles.buttonDisabled]}
                onPress={handleChangePassword}
                disabled={changingPassword}
              >
                <Text style={styles.saveButtonText}>{changingPassword ? 'Changing...' : 'Update Password'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => {
                  setShowPasswordChange(false);
                  setCurrentPassword('');
                  setNewPassword('');
                }}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          )}
        </>
      )}

      {isGoogleUser && (
        <View style={styles.infoBox}>
          <Text style={styles.infoText}>✓ Signed in with Google</Text>
          <Text style={styles.infoSubtext}>Password management is handled by Google</Text>
        </View>
      )}

      {/* Admin Button - only shows if user is admin */}
      {isAdmin && (
        <TouchableOpacity
          style={styles.adminButton}
          onPress={() => router.push('/AdminScreen')}
        >
          <Text style={styles.adminButtonText}>⚙️ Admin Panel</Text>
        </TouchableOpacity>
      )}

      {/* Bottom Buttons */}
      <View style={styles.bottomButtons}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
          <Text style={styles.signOutButtonText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0F1A' },
  loadingContainer: { flex: 1, backgroundColor: '#0B0F1A', justifyContent: 'center', alignItems: 'center' },
  header: { padding: 20, paddingTop: 40, backgroundColor: '#1A1F2E', borderBottomWidth: 1, borderBottomColor: '#2d3748', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: 'bold', color: '#15803d' },
  statsCard: { backgroundColor: '#1A1F2E', margin: 20, padding: 20, borderRadius: 12, alignItems: 'center' },
  statsNumber: { fontSize: 48, fontWeight: 'bold', color: '#15803d' },
  statsLabel: { fontSize: 14, color: '#94a3b8', marginTop: 5 },
  section: { backgroundColor: '#1A1F2E', marginHorizontal: 20, marginBottom: 20, padding: 16, borderRadius: 12 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: 'white', marginBottom: 4 },
  sectionSubtitle: { fontSize: 12, color: '#94a3b8', marginBottom: 12 },
  input: { backgroundColor: '#0B0F1A', color: 'white', padding: 12, borderRadius: 8, fontSize: 16, marginBottom: 8 },
  hint: { fontSize: 11, color: '#64748b', marginBottom: 12 },
  saveButton: { backgroundColor: '#15803d', padding: 12, borderRadius: 8, alignItems: 'center' },
  buttonDisabled: { opacity: 0.6 },
  saveButtonText: { color: 'white', fontSize: 16, fontWeight: '600' },
  changePasswordButton: { backgroundColor: '#1A1F2E', marginHorizontal: 20, marginBottom: 20, padding: 14, borderRadius: 8, alignItems: 'center' },
  changePasswordText: { color: '#15803d', fontSize: 16, fontWeight: '600' },
  cancelButton: { marginTop: 12, alignItems: 'center' },
  cancelText: { color: '#94a3b8', fontSize: 14 },
  infoBox: { backgroundColor: '#1A1F2E', marginHorizontal: 20, marginBottom: 20, padding: 16, borderRadius: 12, alignItems: 'center' },
  infoText: { color: '#15803d', fontSize: 14, fontWeight: '600', marginBottom: 4 },
  infoSubtext: { color: '#94a3b8', fontSize: 12 },
  adminButton: { backgroundColor: '#7c3aed', marginHorizontal: 20, marginBottom: 20, padding: 14, borderRadius: 8, alignItems: 'center' },
  adminButtonText: { color: 'white', fontSize: 16, fontWeight: '600' },
  bottomButtons: { flexDirection: 'row', justifyContent: 'space-between', marginHorizontal: 20, marginBottom: 30, gap: 10 },
  backButton: { flex: 1, backgroundColor: '#64748b', padding: 14, borderRadius: 8, alignItems: 'center' },
  backButtonText: { color: 'white', fontSize: 16, fontWeight: '600' },
  signOutButton: { flex: 1, backgroundColor: '#b91c1c', padding: 14, borderRadius: 8, alignItems: 'center' },
  signOutButtonText: { color: 'white', fontSize: 16, fontWeight: '600' },
});