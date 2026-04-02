import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyCtoXToX5JwHIMvHoiW3489SZlc2wlxi3s",
  authDomain: "fuelup-bf98e.firebaseapp.com",
  projectId: "fuelup-bf98e",
  storageBucket: "fuelup-bf98e.appspot.com",
  messagingSenderId: "240348590748",
  appId: "1:240348590748:web:5695225c851a1e550f3359"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

export { auth, db };
