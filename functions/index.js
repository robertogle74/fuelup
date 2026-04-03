const functions = require('firebase-functions');
const admin = require('firebase-admin');
const fetch = require('node-fetch');

admin.initializeApp();

const GOOGLE_PLACES_API_KEY = 'AIzaSyCKN-E8wh4_f8zZ1wmiFcXgJ4VeHBMtAPA';

exports.getNearbyStations = functions.https.onCall(async (data, context) => {
  // No authentication required - anyone can search for garages
  const { lat, lng, radius } = data;

  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&type=gas_station&key=${GOOGLE_PLACES_API_KEY}`;

  const response = await fetch(url);
  const results = await response.json();

  return {
    status: results.status,
    results: results.results || []
  };
});