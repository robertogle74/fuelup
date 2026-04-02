import { makeRedirectUri } from 'expo-auth-session';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { createUserWithEmailAndPassword, GoogleAuthProvider, sendPasswordResetEmail, signInWithCredential, signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { auth, db } from '../firebase';

WebBrowser.maybeCompleteAuthSession();

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
  // Email/Password state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [isResetMode, setIsResetMode] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [loading, setLoading] = useState(false);
  
  // Google Sign-In state
  const [googleLoading, setGoogleLoading] = useState(false);
  const [pendingGoogleUser, setPendingGoogleUser] = useState(null);
  const [showNameModal, setShowNameModal] = useState(false);
  const [tempDisplayName, setTempDisplayName] = useState('');

  // Google OAuth configuration
  const [request, response, promptAsync] = Google.useAuthRequest({
    androidClientId: '688931952557-fs8r88t59qech3iplu5dgigs1lm635if.apps.googleusercontent.com',
    iosClientId: '',
    expoClientId: '688931952557-jqutvr6m2g73uov59573vgb9cu5l7fod.apps.googleusercontent.com',
    redirectUri: makeRedirectUri({
      scheme: 'fuelup',
      useProxy: true,
    }),
  });

  // Handle Google Sign-In response
  useState(() => {
    if (response?.type === 'success') {
      setGoogleLoading(true);
      const { id_token } = response.params;
      const credential = GoogleAuthProvider.credential(id_token);
      signInWithCredential(auth, credential)
        .then(async (userCredential) => {
          const user = userCredential.user;
          
          // Check if user is blocked
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          if (userDoc.exists() && userDoc.data().blocked === true) {
            Alert.alert('Account Blocked', 'This account has been blocked.');
            await auth.signOut();
            setGoogleLoading(false);
            return;
          }
          
          // If new user, ask for display name
          if (!userDoc.exists()) {
            setPendingGoogleUser(user);
            setShowNameModal(true);
            setGoogleLoading(false);
            return;
          }
          
          // Existing user - check if they have a display name
          if (!userDoc.data().displayName) {
            setPendingGoogleUser(user);
            setShowNameModal(true);
            setGoogleLoading(false);
            return;
          }
          
          onLoginSuccess(user);
          onClose();
        })
        .catch((error) => {
          console.error('Google login error:', error);
          Alert.alert('Login Failed', error.message);
        })
        .finally(() => {
          setGoogleLoading(false);
        });
    }
  }, [response]);

  const completeGoogleSignUp = async () => {
    const validation = validateDisplayName(tempDisplayName);
    if (!validation.valid) {
      Alert.alert('Invalid Display Name', validation.message);
      return;
    }
    
    setLoading(true);
    try {
      // Check if this email should be admin
      const isAdmin = ADMIN_EMAILS.includes(pendingGoogleUser.email);
      
      await setDoc(doc(db, 'users', pendingGoogleUser.uid), {
        email: pendingGoogleUser.email,
        displayName: tempDisplayName.trim(),
        createdAt: new Date(),
        blocked: false,
        totalUpdates: 0,
        lastActive: new Date(),
        isAdmin: isAdmin
      });
      
      onLoginSuccess(pendingGoogleUser);
      setShowNameModal(false);
      setTempDisplayName('');
      setPendingGoogleUser(null);
      onClose();
    } catch (error) {
      console.error('Google signup error:', error);
      Alert.alert('Error', 'Failed to save user data');
    } finally {
      setLoading(false);
    }
  };

  // Email/Password Sign Up or Sign In
  const handleEmailSubmit = async () => {
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

  // Forgot Password
  const handleResetPassword = async () => {
    // Email validation
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

  // Name selection modal for existing users without display name
  if (showNameModal) {
    return (
      <Modal visible={visible} transparent={true} animationType="fade" onRequestClose={onClose}>
        <View style={styles.overlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.title}>Choose Your Name</Text>
            <Text style={styles.message}>
              Please choose a display name that will appear next to your price updates.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Display Name (3-20 characters)"
              placeholderTextColor="#64748b"
              value={tempDisplayName}
              onChangeText={setTempDisplayName}
              autoCapitalize="words"
              maxLength={20}
            />
            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={completeGoogleSignUp}
              disabled={loading}
            >
              {loading ? <ActivityIndicator color="white" /> : <Text style={styles.buttonText}>Continue</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

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

          {/* Google Sign-In Button */}
          <TouchableOpacity
            style={[styles.googleButton, googleLoading && styles.buttonDisabled]}
            onPress={() => promptAsync()}
            disabled={googleLoading}
          >
            {googleLoading ? (
              <ActivityIndicator color="white" />
            ) : (
              <>
                <Image 
                  source={{ uri: 'https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg' }}
                  style={styles.googleIcon}
                />
                <Text style={styles.googleButtonText}>Continue with Google</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={styles.dividerContainer}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR</Text>
            <View style={styles.dividerLine} />
          </View>

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
            onPress={handleEmailSubmit}
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
  googleButton: {
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    width: '100%',
    justifyContent: 'center',
    marginBottom: 16,
  },
  googleIcon: {
    width: 20,
    height: 20,
    marginRight: 12,
  },
  googleButtonText: {
    color: '#1A1F2E',
    fontSize: 16,
    fontWeight: '600',
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginBottom: 16,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#64748b',
  },
  dividerText: {
    color: '#94a3b8',
    paddingHorizontal: 10,
    fontSize: 12,
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