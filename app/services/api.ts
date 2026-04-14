// Google Places API key
const API_KEY = 'AIzaSyDHCI1TrExTmvtFqkRu7rLXJbdvkxsj5L0';

// Original function - gets up to 20 garages (fast)
export const getNearbyStations = async (lat: number, lng: number, radius: number) => {
  try {
    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&type=gas_station&key=${API_KEY}`;
    
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

// NEW FUNCTION: Gets ALL garages using pagination (slower but complete)
export const getAllNearbyStations = async (lat: number, lng: number, radius: number) => {
  try {
    console.log('🌐 Getting ALL garages with pagination...');
    let allStations: any[] = [];
    let nextPageToken: string | null = null;
    let pageCount = 0;
    const MAX_PAGES = 3; // Limit to 3 pages (about 60 garages) to avoid rate limits
    
    do {
      pageCount++;
      // Add delay between requests (required by Google)
      if (nextPageToken) {
        console.log(`⏳ Waiting 2 seconds before next page...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&type=gas_station&key=${API_KEY}${nextPageToken ? `&pagetoken=${nextPageToken}` : ''}`;
      
      console.log(`📄 Fetching page ${pageCount}...`);
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.status === 'OK' && data.results) {
        allStations = [...allStations, ...data.results];
        console.log(`   Found ${data.results.length} garages on page ${pageCount} (total: ${allStations.length})`);
        nextPageToken = data.next_page_token || null;
      } else if (data.status === 'ZERO_RESULTS') {
        console.log('⚠️ No garages found in this area');
        nextPageToken = null;
      } else {
        console.log(`⚠️ API error: ${data.status} - ${data.error_message}`);
        nextPageToken = null;
      }
      
    } while (nextPageToken && pageCount < MAX_PAGES);
    
    console.log(`✅ Total garages found: ${allStations.length}`);
    return allStations;
    
  } catch (error) {
    console.error('❌ Error fetching all stations:', error);
    return [];
  }
};

// Export default to silence the warning
export default {};