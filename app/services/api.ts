export const getNearbyStations = async (lat: number, lng: number, radius: number) => {
  try {
    // New API key
    const apiKey = 'AIzaSyC2H66I29MVX4KnHGfj5xDEhjeXSC9_wgc';
    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&type=gas_station&key=${apiKey}`;
    
    console.log('🌐 Calling Google Places API directly');
    const response = await fetch(url);
    const data = await response.json();
    
    console.log('📊 API Status:', data.status);
    
    if (data.status === 'OK') {
      console.log('🔍 Found', data.results.length, 'garages');
      return data.results || [];
    } else {
      console.log('⚠️ API returned:', data.status, data.error_message);
    }
    return [];
  } catch (error) {
    console.error('❌ Error fetching stations:', error);
    return [];
  }
};