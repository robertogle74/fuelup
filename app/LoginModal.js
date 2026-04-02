import { createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { auth, db } from '../firebase';

// Profanity filter (basic)
const badWords = ['fuck', 'shit', 'ass', 'bitch', 'cunt', 'damn', 'hell', 'nigga', 'nigger'];

const validateDisplayName = (name) => {
  if (name.length < 3) return { valid: false, message: 'Display name must be at least 3 characters' };
  if (name.length > 20) return { valid: false, message: 'Display name must be less than 20 characters' };
  const lowerName = name.toLowerCase();
  for (const badWord of badWords) {
    if (lowerName.includes(badWord)) {
      return { valid: false, message: 'Name contains inappropriate language' };
    }
  }
  return { valid: true, message: '' };
};

const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email) return { valid: false, message: 'Email is required' };
  if (!emailRegex.test(email)) return { valid: false, message: 'Please enter a valid email address' };
  return { valid: true, message: '' };
};

// Admin emails - these users automatically get admin privileges
const ADMIN_EMAILS = ['123@test.com', 'test@123.com', 'oglebrent0@gmail.com', 'ogledevan13@gmail.com', 'robertogle74@gmail.com', 'galiogle77@gmail.com'];

export default function LoginModal({ visible, onClose, onLoginSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [isResetMode, setIsResetMode] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    // Email validation
    const emailValidation = validateEmail(email);
    if (!emailValidation.valid) {
      Alert.alert('Invalid Email', emailValidation.message);
      return;
    }

    if (!email || !password) {
      Alert.alert('Error', 'Please enter email and password');
      return;
    }

    if (isSignUp) {
      const validation = validateDisplayName(displayName);
      if (!validation.valid) {
        Alert.alert('Invalid Display Name', validation.message);
        return;
      }
    }

    if (!isSignUp && password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    try {
      let userCredential;
      
      if (isSignUp) {
        // Create new account
        userCredential = await createUserWithEmailAndPassword(auth, email, password);
        
        // Check if this email should be admin
        const isAdmin = ADMIN_EMAILS.includes(email);
        
        // Add user to Firestore with display name
        await setDoc(doc(db, 'users', userCredential.user.uid), {
          email: userCredential.user.email,
          displayName: displayName.trim(),
          createdAt: new Date(),
          blocked: false,
          totalUpdates: 0,
          lastActive: new Date(),
          isAdmin: isAdmin
        });
      } else {
        // Sign in existing user
        userCredential = await signInWithEmailAndPassword(auth, email, password);
        
        // Check if user is blocked
        const userDoc = await getDoc(doc(db, 'users', userCredential.user.uid));
        if (userDoc.exists() && userDoc.data().blocked === true) {
          Alert.alert('Account Blocked', 'This account has been blocked.');
          await auth.signOut();
          setLoading(false);
          return;
        }
        
        // Update last active
        await updateDoc(doc(db, 'users', userCredential.user.uid), {
          lastActive: new Date()
        });
      }
      
      onLoginSuccess(userCredential.user);
      onClose();
      setEmail('');
      setPassword('');
      setDisplayName('');
    } catch (error) {
      let message = 'Authentication failed';
      if (error.code === 'auth/user-not-found') message = 'User not found';
      if (error.code === 'auth/wrong-password') message = 'Wrong password';
      if (error.code === 'auth/email-already-in-use') message = 'Email already registered';
      if (error.code === 'auth/weak-password') message = 'Password must be at least 6 characters';
      Alert.alert('Error', message);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    const emailValidation = validateEmail(resetEmail);
    if (!emailValidation.valid) {
      Alert.alert('Invalid Email', emailValidation.message);
      return;
    }

    if (!resetEmail) {
      Alert.alert('Error', 'Please enter your email address');
      return;
    }
    
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, resetEmail);
      Alert.alert('Success', 'Password reset email sent! Check your inbox.');
      setIsResetMode(false);
      setResetEmail('');
    } catch (error) {
      Alert.alert('Error', 'Failed to send reset email');
    } finally {
      setLoading(false);
    }
  };

  // Reset Modal (for forgot password)
  if (isResetMode) {
    return (
      <Modal visible={visible} transparent={true} animationType="fade" onRequestClose={onClose}>
        <View style={styles.overlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.title}>Reset Password</Text>
            <Text style={styles.message}>
              Enter your email address and we'll send you a link to reset your password.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor="#64748b"
              value={resetEmail}
              onChangeText={setResetEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleResetPassword}
              disabled={loading}
            >
              {loading ? <ActivityIndicator color="white" /> : <Text style={styles.buttonText}>Send Reset Email</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelButton} onPress={() => { setIsResetMode(false); setResetEmail(''); }}>
              <Text style={styles.cancelText}>Back to Sign In</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  // Main Login Modal
  return (
    <Modal visible={visible} transparent={true} animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.modalContainer}>
          <Text style={styles.title}>{isSignUp ? 'Create Account' : 'Sign In'}</Text>
          <Text style={styles.message}>
            {isSignUp ? 'Create an account to update fuel prices' : 'Sign in to update fuel prices'}
          </Text>

          {/* Email/Password Form */}
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor="#64748b"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />

          {isSignUp && (
            <TextInput
              style={styles.input}
              placeholder="Display Name (3-20 characters)"
              placeholderTextColor="#64748b"
              value={displayName}
              onChangeText={setDisplayName}
              autoCapitalize="words"
              maxLength={20}
            />
          )}

          <View style={styles.passwordContainer}>
            <TextInput
              style={styles.passwordInput}
              placeholder="Password (min 6 characters)"
              placeholderTextColor="#64748b"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
            />
            <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeButton}>
              <Text style={styles.eyeText}>{showPassword ? '👁️' : '👁️‍🗨️'}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? <ActivityIndicator color="white" /> : <Text style={styles.buttonText}>{isSignUp ? 'Sign Up' : 'Sign In'}</Text>}
          </TouchableOpacity>

          {!isSignUp && (
            <TouchableOpacity onPress={() => setIsResetMode(true)} style={styles.forgotButton}>
              <Text style={styles.forgotText}>Forgot Password?</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            onPress={() => {
              setIsSignUp(!isSignUp);
              setEmail('');
              setPassword('');
              setDisplayName('');
            }}
            style={styles.switchButton}
          >
            <Text style={styles.switchText}>
              {isSignUp ? 'Already have an account? Sign In' : 'Need an account? Sign Up'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
            <Text style={styles.cancelText}>Maybe later</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContainer: {
    backgroundColor: '#1A1F2E',
    borderRadius: 16,
    padding: 24,
    width: '90%',
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#15803d',
    marginBottom: 8,
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    color: '#94a3b8',
    textAlign: 'center',
    marginBottom: 20,
  },
  input: {
    backgroundColor: '#0B0F1A',
    color: 'white',
    padding: 12,
    borderRadius: 8,
    width: '100%',
    marginBottom: 12,
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginBottom: 12,
  },
  passwordInput: {
    flex: 1,
    backgroundColor: '#0B0F1A',
    color: 'white',
    padding: 12,
    borderRadius: 8,
  },
  eyeButton: {
    position: 'absolute',
    right: 12,
    padding: 8,
  },
  eyeText: {
    fontSize: 18,
    color: '#94a3b8',
  },
  button: {
    backgroundColor: '#15803d',
    paddingVertical: 12,
    borderRadius: 8,
    width: '100%',
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  forgotButton: {
    marginTop: 8,
  },
  forgotText: {
    color: '#94a3b8',
    fontSize: 12,
  },
  switchButton: {
    marginTop: 12,
  },
  switchText: {
    color: '#15803d',
    fontSize: 14,
  },
  cancelButton: {
    marginTop: 16,
    paddingVertical: 8,
  },
  cancelText: {
    color: '#94a3b8',
    fontSize: 14,
  },
});