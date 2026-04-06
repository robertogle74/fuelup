import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';

admin.initializeApp();

const GOOGLE_PLACES_API_KEY = 'AIzaSyCKN-E8wh4_f8zZ1wmiFcXgJ4VeHBMtAPA';

export const getNearbyStations = functions.https.onCall(async (data, context) => {
  // Require user to be logged in
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'You must be logged in to use this feature'
    );
  }

  const { lat, lng, radius } = data;

  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&type=gas_station&key=${GOOGLE_PLACES_API_KEY}`;

  const response = await fetch(url);
  const results = await response.json();

  return {
    status: results.status,
    results: results.results || []
  };
});