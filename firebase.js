import ReactNativeAsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp } from 'firebase/app';
import { getReactNativePersistence, initializeAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: "fuelup-bf98e.firebaseapp.com",
  projectId: "fuelup-bf98e",
  storageBucket: "fuelup-bf98e.appspot.com",
  messagingSenderId: "240348590748",
  appId: "1:240348590748:web:5695225c851a1e550f3359"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(ReactNativeAsyncStorage)
});
const functions = getFunctions(app);

export { auth, db, functions };
