// Import Authentication functions
import {
    initializeAuth,
    signInWithGoogle,
    signUpWithEmail,
    signInWithEmail,
    signOutUser,
    getCurrentUser,
    getCurrentUserProfile,
    isAuthenticated,
    incrementUserLocationCount,
    decrementUserLocationCount,
    getLeaderboard,
    updateUserNickname,
    uploadLocationPhotos,
    authHeaders
} from './supabase-auth.js';

// Global variables
let map;
let markers = [];
let locations = [];
let filteredLocations = [];
let selectedLocation = null;
let tempMarker = null;
let isSelectingLocation = false;
let addressSuggestions = [];
let currentSuggestionIndex = -1;
let userVotes = {}; // Track user's votes: { locationId: 'up'|'down'|null }

// Make loadUserVotes globally accessible for Firebase auth
window.loadUserVotes = null;
window.userVotes = userVotes;

// DOM elements
const locationsList = document.getElementById('locationsList');
const locationCount = document.getElementById('locationCount');
const searchInput = document.getElementById('searchInput');
const addLocationBtn = document.getElementById('addLocationBtn');
const addLocationModal = document.getElementById('addLocationModal');
const addLocationForm = document.getElementById('addLocationForm');
const closeModal = document.querySelector('.close');
const cancelBtn = document.getElementById('cancelBtn');
const loadingSpinner = document.getElementById('loadingSpinner');
const locationCoordinates = document.getElementById('locationCoordinates');
const clearLocationBtn = document.getElementById('clearLocationBtn');
const locationAddress = document.getElementById('locationAddress');
const addressSuggestionsEl = document.getElementById('addressSuggestions');
const locationPhotosInput = document.getElementById('locationPhotos');
const photoPreview = document.getElementById('photoPreview');

// Edit location modal elements
const editLocationModal = document.getElementById('editLocationModal');
const editLocationForm = document.getElementById('editLocationForm');
const editModalClose = document.getElementById('editModalClose');
const editCancelBtn = document.getElementById('editCancelBtn');
const editLocationId = document.getElementById('editLocationId');
const editLocationName = document.getElementById('editLocationName');
const editLocationAddress = document.getElementById('editLocationAddress');
const editLocationDescription = document.getElementById('editLocationDescription');
const editLocationCoordinates = document.getElementById('editLocationCoordinates');
const editClearLocationBtn = document.getElementById('editClearLocationBtn');
const editAddressSuggestionsEl = document.getElementById('editAddressSuggestions');
const editLocationPhotosInput = document.getElementById('editLocationPhotos');
const editPhotoPreview = document.getElementById('editPhotoPreview');
const editCurrentPhotos = document.getElementById('editCurrentPhotos');

let editingLocation = null;
let photosToRemove = [];

// Current country state
let currentCountry = 'SG';

// Initialize the application
document.addEventListener('DOMContentLoaded', async function() {
    initCountryFromURL();
    initializeMap();
    loadLocations();
    setupEventListeners();
    await initializeAuth();
    setupAuthEventListeners();
    setupCountrySelector();
});

// Read country from URL and validate
function initCountryFromURL() {
    const params = new URLSearchParams(window.location.search);
    const country = (params.get('country') || 'SG').toUpperCase();
    currentCountry = COUNTRIES[country] ? country : 'SG';
    updateBranding();
}

// Populate and wire up the country selector
function setupCountrySelector() {
    const selector = document.getElementById('countrySelector');
    if (!selector) return;

    selector.innerHTML = COUNTRY_REGIONS.map(region => {
        const countries = Object.values(COUNTRIES)
            .filter(c => c.region === region)
            .sort((a, b) => a.name.localeCompare(b.name));
        const options = countries.map(c =>
            `<option value="${c.code}" ${c.code === currentCountry ? 'selected' : ''}>${c.flag} ${c.name}</option>`
        ).join('');
        return `<optgroup label="${region}">${options}</optgroup>`;
    }).join('');

    selector.addEventListener('change', function() {
        currentCountry = this.value;
        const url = new URL(window.location);
        url.searchParams.set('country', currentCountry.toLowerCase());
        window.history.pushState({}, '', url);
        const config = COUNTRIES[currentCountry];
        map.setView(config.center, config.zoom);
        loadLocations();
        updateBranding();
    });

    window.addEventListener('popstate', function() {
        initCountryFromURL();
        const config = COUNTRIES[currentCountry];
        map.setView(config.center, config.zoom);
        const sel = document.getElementById('countrySelector');
        if (sel) sel.value = currentCountry;
        loadLocations();
    });
}

// Update page title and header
function updateBranding() {
    const config = COUNTRIES[currentCountry];
    document.title = `Stripe Terminal Locator - ${config.flag} ${config.name}`;
    const h1 = document.querySelector('.header-text h1');
    const p = document.querySelector('.header-text p');
    if (h1) h1.textContent = `Stripe Terminal Locator ${config.flag}`;
    if (p) p.textContent = `Find Stripe terminal reader locations in ${config.name}`;
}

// Initialize the map
function initializeMap() {
    const config = COUNTRIES[currentCountry];
    map = L.map('map').setView(config.center, config.zoom);
    
    // Expose map to window for auth state handler
    window.map = map;
    
    // Add OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);
    
    // Add click event to map for location selection or normal behavior
    map.on('click', function(e) {
        if (isSelectingLocation) {
            selectLocationFromMap(e.latlng);
        }
    });

    // Right-click (desktop) or long-press (mobile) to add location directly
    map.on('contextmenu', function(e) {
        if (!isAuthenticated()) return;
        selectLocationFromMap(e.latlng);
        showAddLocationModal();
    });
}

// Load locations from API
async function loadLocations() {
    showLoading(true);
    try {
        const response = await fetch(`/api/locations?country=${currentCountry}`);
        if (!response.ok) {
            throw new Error('Failed to fetch locations');
        }
        
        locations = await response.json();
        filteredLocations = [...locations];
        displayLocations();
        updateLocationCount();
        
        // Load user votes after locations are loaded
        await loadUserVotes();
    } catch (error) {
        console.error('Error loading locations:', error);
        showNotification('Error loading locations. Please refresh the page.', 'error');
    } finally {
        showLoading(false);
    }
}

// Display locations on map and in list
function displayLocations() {
    // Clear existing markers
    markers.forEach(marker => map.removeLayer(marker));
    markers = [];
    
    // Add new markers
    filteredLocations.forEach(location => {
        const marker = L.marker([location.latitude, location.longitude])
            .bindPopup(createPopupContent(location))
            .addTo(map);
        
        marker.on('click', function() {
            highlightLocation(location.id);
        });
        
        // Setup vote, edit, delete, and maps listeners when popup is opened
        marker.on('popupopen', function() {
            setupVoteButtonListeners();
            setupEditButtonListeners();
            setupDeleteButtonListeners();
            setupMapsButtonListeners();
            setupPhotoClickListeners();
        });
        
        markers.push(marker);
    });
    
    // Display in list
    displayLocationsList();
    
    // Fit map to show all markers if there are any
    if (markers.length > 0) {
        const group = new L.featureGroup(markers);
        map.fitBounds(group.getBounds().pad(0.1));
    }
}

// Create popup content for markers
function createPopupContent(location) {
    const upvotes = location.upvotes || 0;
    const downvotes = location.downvotes || 0;
    const accuracyRating = getAccuracyRating(upvotes, downvotes);
    
    // Get user's vote state for this location
    const userVote = userVotes[location.id];
    const upvoteClass = userVote === 'up' ? 'vote-btn upvote user-voted' : 'vote-btn upvote';
    const downvoteClass = userVote === 'down' ? 'vote-btn downvote user-voted' : 'vote-btn downvote';
    
    // Check if current user owns this location
    const currentUser = getCurrentUser();
    const isOwner = currentUser && location.createdBy === currentUser.uid;
    
    // Creator information
    const creatorInfo = location.createdByNickname ? 
        `<div class="popup-creator">Added by: ${location.createdByNickname}${isOwner ? ' (You)' : ''}</div>` : '';
    
    // Photos gallery (thumbnails that open full viewer)
    const photosGallery = location.photos && location.photos.length > 0 ? 
        `<div class="popup-photos">
            ${location.photos.map((photo, index) => {
                // Support both old format (string) and new format (object with thumb/full)
                const thumbURL = typeof photo === 'string' ? photo : (photo.thumb || photo.full);
                const fullURL = typeof photo === 'string' ? photo : photo.full;
                return `<img src="${thumbURL}" alt="${location.name} photo ${index + 1}" class="popup-photo" data-photo-url="${fullURL}" data-photo-index="${index}" data-location-id="${location.id}">`;
            }).join('')}
        </div>` : '';
    
    // Owner action buttons (edit and delete)
    const ownerButtons = isOwner ? 
        `<div class="popup-owner-actions">
            <button class="edit-btn popup-edit-btn" data-location-id="${location.id}" title="Edit this location">
                ✏️ Edit
            </button>
            <button class="delete-btn popup-delete-btn" data-location-id="${location.id}" title="Delete this location">
                × Delete
            </button>
        </div>` : '';
    
    return `
        <div class="popup-content">
            <div class="popup-title">${location.name}</div>
            <div class="popup-address">${location.address}</div>
            ${photosGallery}
            ${location.description ? `<div class="popup-description">${location.description}</div>` : ''}
            ${creatorInfo}
            <div class="popup-voting">
                <div class="vote-buttons">
                    <button class="${upvoteClass}" data-location-id="${location.id}" data-vote-type="up">
                        <span class="vote-icon">👍</span>
                        <span class="vote-count">${upvotes}</span>
                    </button>
                    <button class="${downvoteClass}" data-location-id="${location.id}" data-vote-type="down">
                        <span class="vote-icon">👎</span>
                        <span class="vote-count">${downvotes}</span>
                    </button>
                </div>
                <div class="popup-actions">
                    <div class="accuracy-rating ${accuracyRating.class}">
                        ${accuracyRating.text}
                    </div>
                    <button class="maps-btn popup-maps-btn" data-lat="${location.latitude}" data-lng="${location.longitude}" data-name="${encodeURIComponent(location.name)}" data-address="${encodeURIComponent(location.address)}" title="Open in Google Maps">
                        🗺️ Open in Maps
                    </button>
                </div>
            </div>
            ${ownerButtons}
        </div>
    `;
}

// Display locations in the list
function displayLocationsList() {
    locationsList.innerHTML = '';
    
    filteredLocations.forEach(location => {
        const locationItem = document.createElement('div');
        locationItem.className = 'location-item';
        locationItem.dataset.id = location.id;
        
        const upvotes = location.upvotes || 0;
        const downvotes = location.downvotes || 0;
        const totalVotes = upvotes + downvotes;
        const accuracyRating = getAccuracyRating(upvotes, downvotes);
        
        // Get user's vote state for this location
        const userVote = userVotes[location.id];
        const upvoteClass = userVote === 'up' ? 'vote-btn upvote user-voted' : 'vote-btn upvote';
        const downvoteClass = userVote === 'down' ? 'vote-btn downvote user-voted' : 'vote-btn downvote';
        
        // Check if current user owns this location
        const currentUser = getCurrentUser();
        const isOwner = currentUser && location.createdBy === currentUser.uid;
        
        // Creator information
        const creatorInfo = location.createdByNickname ? 
            `<div class="location-creator">Added by: ${location.createdByNickname}${isOwner ? ' (You)' : ''}</div>` : '';
        
        // Owner action buttons
        const ownerButtons = isOwner ? 
            `<div class="location-owner-buttons">
                <button class="edit-btn" data-location-id="${location.id}" title="Edit this location">
                    ✏️
                </button>
                <button class="delete-btn" data-location-id="${location.id}" title="Delete this location">
                    <span class="delete-icon">×</span>
                </button>
            </div>` : '';
        
        // Photos thumbnail
        const photosThumbnail = location.photos && location.photos.length > 0 ? 
            (() => {
                const firstPhoto = location.photos[0];
                const thumbURL = typeof firstPhoto === 'string' ? firstPhoto : (firstPhoto.thumb || firstPhoto.full);
                return `<div class="location-photos-thumb" data-location-id="${location.id}">
                    <img src="${thumbURL}" alt="${location.name} photo" class="location-photo-thumb" data-location-id="${location.id}">
                    ${location.photos.length > 1 ? `<span class="photo-count">+${location.photos.length - 1}</span>` : ''}
                </div>`;
            })() : '';
        
        locationItem.innerHTML = `
            <div class="location-header">
                <div class="location-main">
                    <div class="location-name">${location.name}</div>
                    <div class="location-address">${location.address}</div>
                    ${photosThumbnail}
                    ${location.description ? `<div class="location-description">${location.description}</div>` : ''}
                    ${creatorInfo}
                </div>
                ${ownerButtons}
            </div>
            <div class="voting-section">
                <div class="vote-buttons">
                    <button class="${upvoteClass}" data-location-id="${location.id}" data-vote-type="up">
                        <span class="vote-icon">👍</span>
                        <span class="vote-count">${upvotes}</span>
                    </button>
                    <button class="${downvoteClass}" data-location-id="${location.id}" data-vote-type="down">
                        <span class="vote-icon">👎</span>
                        <span class="vote-count">${downvotes}</span>
                    </button>
                </div>
                <div class="location-actions">
                    <div class="accuracy-rating ${accuracyRating.class}">
                        ${accuracyRating.text}
                    </div>
                    <button class="maps-btn" data-lat="${location.latitude}" data-lng="${location.longitude}" data-name="${encodeURIComponent(location.name)}" data-address="${encodeURIComponent(location.address)}" title="Open in Google Maps">
                        🗺️ Maps
                    </button>
                </div>
            </div>
        `;
        
        // Add click event for the main location item (excluding vote, edit, delete, and maps buttons)
        locationItem.addEventListener('click', function(e) {
            // Don't trigger if clicking on vote buttons, edit button, delete button, or maps button
            if (e.target.closest('.vote-btn') || e.target.closest('.edit-btn') || e.target.closest('.delete-btn') || e.target.closest('.maps-btn')) return;
            
            const loc = locations.find(l => l.id === location.id);
            if (loc) {
                map.setView([loc.latitude, loc.longitude], 15);
                highlightLocation(location.id);
                
                // Open popup for the corresponding marker
                const marker = markers.find(m => 
                    m.getLatLng().lat === loc.latitude && 
                    m.getLatLng().lng === loc.longitude
                );
                if (marker) {
                    marker.openPopup();
                }
            }
        });
        
        locationsList.appendChild(locationItem);
    });
    
        // Add event listeners for vote, edit, delete, and maps buttons
        setupVoteButtonListeners();
        setupEditButtonListeners();
        setupDeleteButtonListeners();
        setupMapsButtonListeners();
        setupListPhotoClickListeners();
}

// Highlight a location in the list
function highlightLocation(locationId) {
    // Remove existing highlights
    document.querySelectorAll('.location-item').forEach(item => {
        item.classList.remove('active');
    });
    
    // Add highlight to selected location
    const selectedItem = document.querySelector(`[data-id="${locationId}"]`);
    if (selectedItem) {
        selectedItem.classList.add('active');
        selectedItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

// Update location count
function updateLocationCount() {
    locationCount.textContent = filteredLocations.length;
}

// Filter locations based on search
function filterLocations(searchTerm) {
    const term = searchTerm.toLowerCase().trim();
    
    if (!term) {
        filteredLocations = [...locations];
    } else {
        filteredLocations = locations.filter(location => 
            location.name.toLowerCase().includes(term) ||
            location.address.toLowerCase().includes(term) ||
            (location.description && location.description.toLowerCase().includes(term))
        );
    }
    
    displayLocations();
    updateLocationCount();
}

// Show/hide loading spinner
function showLoading(show) {
    loadingSpinner.style.display = show ? 'flex' : 'none';
}

// Show add location modal
function showAddLocationModal() {
    // Clear previous selection
    clearSelectedLocation();
    
    // Enable location selection mode
    isSelectingLocation = true;
    map.getContainer().style.cursor = 'crosshair';
    
    addLocationModal.style.display = 'block';
    document.getElementById('locationName').focus();
}

// Hide add location modal
function hideAddLocationModal() {
    addLocationModal.style.display = 'none';
    addLocationForm.reset();
    
    // Disable location selection mode
    isSelectingLocation = false;
    map.getContainer().style.cursor = '';
    
    // Clear location selection
    clearSelectedLocation();
    
    // Hide address suggestions
    hideAddressSuggestions();
    
    // Clear photo preview
    if (photoPreview) {
        photoPreview.innerHTML = '';
    }
}

// Add new location
async function addLocation(locationData, photoFiles) {
    let enrichedLocationData = { ...locationData };
    
    // If authentication is available and user is signed in, add user info
    if (isAuthenticated()) {
        const user = getCurrentUser();
        const userProfile = getCurrentUserProfile();

        enrichedLocationData = {
            ...locationData,
            createdBy: user.uid,
            createdByNickname: userProfile?.nickname || userProfile?.displayName || user.email,
            createdByEmail: user.email,
            countryCode: currentCountry
        };
    } else {
        enrichedLocationData = {
            ...locationData,
            createdBy: null,
            createdByNickname: 'Anonymous',
            createdByEmail: null,
            countryCode: currentCountry
        };
    }
    
    showLoading(true);
    try {
        const response = await fetch('/api/locations', {
            method: 'POST',
            headers: await authHeaders(),
            body: JSON.stringify(enrichedLocationData)
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to add location');
        }
        
        const newLocation = await response.json();
        // Initialize vote counts if not present
        if (!newLocation.upvotes) newLocation.upvotes = 0;
        if (!newLocation.downvotes) newLocation.downvotes = 0;
        
        // Upload photos if any
        if (photoFiles && photoFiles.length > 0) {
            try {
                showNotification(`Processing and uploading ${photoFiles.length} photo(s)...`, 'info');
                const photoURLs = await uploadLocationPhotos(newLocation.id, photoFiles);
                
                if (photoURLs.length > 0) {
                    // Update location with photo URLs
                    const updateResponse = await fetch(`/api/locations/${newLocation.id}/photos`, {
                        method: 'POST',
                        headers: await authHeaders(),
                        body: JSON.stringify({ photoURLs })
                    });
                    
                    if (updateResponse.ok) {
                        const updatedLocation = await updateResponse.json();
                        newLocation.photos = updatedLocation.photos;
                        showNotification(`${photoURLs.length} photo(s) uploaded successfully!`, 'success');
                    }
                }
            } catch (photoError) {
                console.error('Error uploading photos:', photoError);
                showNotification('Location added but some photos failed to upload', 'warning');
            }
        }
        
        locations.push(newLocation);
        filteredLocations = [...locations];
        
        displayLocations();
        updateLocationCount();
        hideAddLocationModal();
        
        // Increment user's location count (only if authenticated)
        if (isAuthenticated()) {
            const user = getCurrentUser();
            await incrementUserLocationCount(user.uid);
            
        }
        
        showNotification('Location added successfully!', 'success');
        
        // Zoom to new location
        map.setView([newLocation.latitude, newLocation.longitude], 15);
        highlightLocation(newLocation.id);
        
    } catch (error) {
        console.error('Error adding location:', error);
        showNotification(error.message, 'error');
    } finally {
        showLoading(false);
    }
}

// Select location from map click
function selectLocationFromMap(latlng) {
    selectedLocation = {
        latitude: latlng.lat,
        longitude: latlng.lng
    };
    
    // Remove previous temp marker
    if (tempMarker) {
        map.removeLayer(tempMarker);
    }
    
    // Add new temp marker with custom styling
    tempMarker = L.marker([latlng.lat, latlng.lng], {
        icon: L.divIcon({
            className: 'map-click-marker',
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        })
    }).addTo(map);
    
    // Update coordinates display
    updateCoordinatesDisplay(latlng.lat, latlng.lng);
    
    // Try to reverse geocode to get address
    reverseGeocode(latlng.lat, latlng.lng);
}

// Clear selected location
function clearSelectedLocation() {
    selectedLocation = null;
    
    if (tempMarker) {
        map.removeLayer(tempMarker);
        tempMarker = null;
    }
    
    // Reset coordinates display
    locationCoordinates.textContent = 'Right-click on the map (or long press on mobile) to select a location, or search by business name/address in the field above';
    locationCoordinates.classList.remove('has-location');
    clearLocationBtn.style.display = 'none';
}

// Update coordinates display
function updateCoordinatesDisplay(lat, lng) {
    locationCoordinates.textContent = `📍 Selected: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    locationCoordinates.classList.add('has-location');
    clearLocationBtn.style.display = 'inline-block';
}

// Reverse geocoding to get address from coordinates
async function reverseGeocode(lat, lng) {
    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&countrycodes=${currentCountry.toLowerCase()}&accept-language=en`
        );
        const data = await response.json();
        
        if (data && data.display_name) {
            // Auto-fill address if not already filled
            if (!locationAddress.value.trim()) {
                locationAddress.value = data.display_name;
            }
        }
    } catch (error) {
        console.log('Reverse geocoding failed:', error);
    }
}

// Enhanced address and place name search functionality
async function searchAddresses(query) {
    if (query.length < 2) {
        hideAddressSuggestions();
        return;
    }
    
    try {
        // Create multiple search queries for better results
        const searchPromises = [
            // Search for places/businesses by name
            fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&countrycodes=${currentCountry.toLowerCase()}&format=json&limit=3&addressdetails=1&extratags=1&accept-language=en`),
            // Search for addresses
            fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query + ' ' + COUNTRIES[currentCountry].name)}&countrycodes=${currentCountry.toLowerCase()}&format=json&limit=3&addressdetails=1&accept-language=en`),
            // Search for specific business types if query suggests it
            ...(isBusinessQuery(query) ? [
                fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query + ' shop store ' + COUNTRIES[currentCountry].name)}&countrycodes=${currentCountry.toLowerCase()}&format=json&limit=2&addressdetails=1&accept-language=en`)
            ] : [])
        ];
        
        const responses = await Promise.all(searchPromises);
        const results = await Promise.all(responses.map(r => r.json()));
        
        // Combine and deduplicate results
        let allSuggestions = [];
        results.forEach(resultSet => {
            allSuggestions = allSuggestions.concat(resultSet);
        });
        
        // Remove duplicates based on coordinates
        const uniqueSuggestions = [];
        const seenCoords = new Set();
        
        allSuggestions.forEach(suggestion => {
            const coordKey = `${suggestion.lat}_${suggestion.lon}`;
            if (!seenCoords.has(coordKey)) {
                seenCoords.add(coordKey);
                uniqueSuggestions.push(suggestion);
            }
        });
        
        // Sort by relevance and limit results
        const sortedSuggestions = sortSuggestionsByRelevance(uniqueSuggestions, query).slice(0, 6);
        
        addressSuggestions = sortedSuggestions;
        showAddressSuggestions(sortedSuggestions, query);
    } catch (error) {
        console.log('Search failed:', error);
        hideAddressSuggestions();
    }
}

// Show address suggestions with enhanced display
function showAddressSuggestions(suggestions, query = '') {
    addressSuggestionsEl.innerHTML = '';
    
    if (suggestions.length === 0) {
        // Show a helpful message if no results found
        const noResultsItem = document.createElement('div');
        noResultsItem.className = 'suggestion-item no-results';
        noResultsItem.innerHTML = `
            <div class="suggestion-content">
                <span class="suggestion-icon">🔍</span>
                <div class="suggestion-text">
                    <div class="suggestion-title">No results found</div>
                    <div class="suggestion-subtitle">Try searching for business names or addresses</div>
                </div>
            </div>
        `;
        addressSuggestionsEl.appendChild(noResultsItem);
        return;
    }
    
    suggestions.forEach((suggestion, index) => {
        const suggestionItem = document.createElement('div');
        suggestionItem.className = 'suggestion-item';
        suggestionItem.dataset.index = index;
        
        const suggestionInfo = analyzeSuggestion(suggestion);
        
        suggestionItem.innerHTML = `
            <div class="suggestion-content">
                <span class="suggestion-icon">${suggestionInfo.icon}</span>
                <div class="suggestion-text">
                    <div class="suggestion-title">${suggestionInfo.title}</div>
                    <div class="suggestion-subtitle">${suggestionInfo.subtitle}</div>
                </div>
            </div>
        `;
        
        suggestionItem.addEventListener('click', function() {
            selectAddressSuggestion(index);
        });
        
        addressSuggestionsEl.appendChild(suggestionItem);
    });
    
    currentSuggestionIndex = -1;
}

// Hide address suggestions
function hideAddressSuggestions() {
    addressSuggestionsEl.innerHTML = '';
    currentSuggestionIndex = -1;
}

// Select address suggestion
function selectAddressSuggestion(index) {
    if (index < 0 || index >= addressSuggestions.length) return;
    
    const suggestion = addressSuggestions[index];
    locationAddress.value = suggestion.display_name;
    
    // Set coordinates from geocoding
    selectedLocation = {
        latitude: parseFloat(suggestion.lat),
        longitude: parseFloat(suggestion.lon)
    };
    
    // Remove previous temp marker
    if (tempMarker) {
        map.removeLayer(tempMarker);
    }
    
    // Add marker for selected address
    tempMarker = L.marker([suggestion.lat, suggestion.lon], {
        icon: L.divIcon({
            className: 'map-click-marker',
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        })
    }).addTo(map);
    
    // Update display and zoom to location
    updateCoordinatesDisplay(parseFloat(suggestion.lat), parseFloat(suggestion.lon));
    map.setView([suggestion.lat, suggestion.lon], 16);
    
    // Hide suggestions
    hideAddressSuggestions();
    
    // Focus next field
    document.getElementById('locationDescription').focus();
}

// Navigate address suggestions with keyboard
function navigateAddressSuggestions(direction) {
    const items = addressSuggestionsEl.querySelectorAll('.suggestion-item');
    if (items.length === 0) return;
    
    // Remove current highlight
    if (currentSuggestionIndex >= 0) {
        items[currentSuggestionIndex].classList.remove('highlighted');
    }
    
    // Update index
    if (direction === 'down') {
        currentSuggestionIndex = Math.min(currentSuggestionIndex + 1, items.length - 1);
    } else if (direction === 'up') {
        currentSuggestionIndex = Math.max(currentSuggestionIndex - 1, -1);
    }
    
    // Apply new highlight
    if (currentSuggestionIndex >= 0) {
        items[currentSuggestionIndex].classList.add('highlighted');
    }
}

// Geocode address to coordinates
async function geocodeAddress(address) {
    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&countrycodes=${currentCountry.toLowerCase()}&format=json&limit=1&accept-language=en`
        );
        const results = await response.json();
        
        if (results.length > 0) {
            return {
                latitude: parseFloat(results[0].lat),
                longitude: parseFloat(results[0].lon)
            };
        }
        return null;
    } catch (error) {
        console.log('Geocoding failed:', error);
        return null;
    }
}

// Show notification
function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    
    // Add styles
    Object.assign(notification.style, {
        position: 'fixed',
        top: '20px',
        right: '20px',
        padding: '1rem 1.5rem',
        borderRadius: '8px',
        color: 'white',
        fontWeight: '600',
        zIndex: '10000',
        transform: 'translateX(400px)',
        transition: 'transform 0.3s ease',
        backgroundColor: type === 'success' ? '#27ae60' : type === 'error' ? '#e74c3c' : '#3498db'
    });
    
    document.body.appendChild(notification);
    
    // Animate in
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 100);
    
    // Auto remove
    setTimeout(() => {
        notification.style.transform = 'translateX(400px)';
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 3000);
}

// Handle photo preview
function handlePhotoPreview(files) {
    photoPreview.innerHTML = '';
    
    if (!files || files.length === 0) {
        return;
    }
    
    // Limit to 5 photos
    const filesToShow = Array.from(files).slice(0, 5);
    
    filesToShow.forEach((file, index) => {
        const reader = new FileReader();
        
        reader.onload = function(e) {
            const previewItem = document.createElement('div');
            previewItem.className = 'photo-preview-item';
            previewItem.innerHTML = `
                <img src="${e.target.result}" alt="Preview ${index + 1}">
                <button type="button" class="remove-photo-btn" data-index="${index}" title="Remove photo">×</button>
            `;
            photoPreview.appendChild(previewItem);
            
            // Add remove button listener
            const removeBtn = previewItem.querySelector('.remove-photo-btn');
            removeBtn.addEventListener('click', function() {
                removePhotoFromPreview(index);
            });
        };
        
        reader.readAsDataURL(file);
    });
    
    if (files.length > 5) {
        showNotification('Only the first 5 photos will be uploaded', 'info');
    }
}

// Remove photo from preview
function removePhotoFromPreview(index) {
    const dt = new DataTransfer();
    const files = locationPhotosInput.files;
    
    for (let i = 0; i < files.length; i++) {
        if (i !== index) {
            dt.items.add(files[i]);
        }
    }
    
    locationPhotosInput.files = dt.files;
    handlePhotoPreview(dt.files);
}

// Setup event listeners
function setupEventListeners() {
    // Search input
    searchInput.addEventListener('input', function() {
        filterLocations(this.value);
    });
    
    // Photo input change
    if (locationPhotosInput) {
        locationPhotosInput.addEventListener('change', function() {
            handlePhotoPreview(this.files);
        });
    }
    
    // Add location button
    addLocationBtn.addEventListener('click', function() {
        showAddLocationModal();
    });
    
    // Clear location button
    clearLocationBtn.addEventListener('click', function() {
        clearSelectedLocation();
    });
    
    // Address input with autocomplete
    let addressSearchTimeout;
    locationAddress.addEventListener('input', function() {
        clearTimeout(addressSearchTimeout);
        const query = this.value.trim();
        
        if (query.length >= 3) {
            addressSearchTimeout = setTimeout(() => {
                searchAddresses(query);
            }, 300);
        } else {
            hideAddressSuggestions();
        }
    });
    
    // Address input keyboard navigation
    locationAddress.addEventListener('keydown', function(event) {
        const suggestionItems = addressSuggestionsEl.querySelectorAll('.suggestion-item');
        
        if (suggestionItems.length === 0) return;
        
        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                navigateAddressSuggestions('down');
                break;
            case 'ArrowUp':
                event.preventDefault();
                navigateAddressSuggestions('up');
                break;
            case 'Enter':
                event.preventDefault();
                if (currentSuggestionIndex >= 0) {
                    selectAddressSuggestion(currentSuggestionIndex);
                } else {
                    // Try to geocode the entered address
                    geocodeEnteredAddress();
                }
                break;
            case 'Escape':
                hideAddressSuggestions();
                break;
        }
    });
    
    // Hide suggestions when clicking outside
    document.addEventListener('click', function(event) {
        if (!locationAddress.contains(event.target) && !addressSuggestionsEl.contains(event.target)) {
            hideAddressSuggestions();
        }
    });
    
    // Modal close events
    closeModal.addEventListener('click', hideAddLocationModal);
    cancelBtn.addEventListener('click', hideAddLocationModal);
    
    // Edit modal close events
    if (editModalClose) {
        editModalClose.addEventListener('click', hideEditLocationModal);
    }
    if (editCancelBtn) {
        editCancelBtn.addEventListener('click', hideEditLocationModal);
    }
    
    // Clear edit location button
    if (editClearLocationBtn) {
        editClearLocationBtn.addEventListener('click', function() {
            selectedLocation = null;
            editLocationCoordinates.textContent = 'Right-click on the map (or long press on mobile) to update location';
            editLocationCoordinates.classList.remove('has-location');
            editClearLocationBtn.style.display = 'none';
        });
    }
    
    // Edit photo input change
    if (editLocationPhotosInput) {
        editLocationPhotosInput.addEventListener('change', function() {
            handleEditPhotoPreview(this.files);
        });
    }
    
    // Close modal when clicking outside
    window.addEventListener('click', function(event) {
        if (event.target === addLocationModal) {
            hideAddLocationModal();
        }
        if (event.target === editLocationModal) {
            hideEditLocationModal();
        }
    });
    
    // Add location form submission
    addLocationForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        // Get form data
        const locationData = {
            name: document.getElementById('locationName').value.trim(),
            address: document.getElementById('locationAddress').value.trim(),
            description: document.getElementById('locationDescription').value.trim()
        };
        
        // Basic validation
        if (!locationData.name || !locationData.address) {
            showNotification('Please fill in all required fields', 'error');
            return;
        }
        
        // Check if we have coordinates (from map click or address selection)
        if (!selectedLocation) {
            // Try to geocode the entered address
            const coords = await geocodeAddress(locationData.address);
            if (coords) {
                selectedLocation = coords;
            } else {
                showNotification('Could not determine coordinates for this address. Please click on the map to select a location.', 'error');
                return;
            }
        }
        
        // Add coordinates to location data
        locationData.latitude = selectedLocation.latitude;
        locationData.longitude = selectedLocation.longitude;
        
        // Get photo files
        const photoFiles = locationPhotosInput ? Array.from(locationPhotosInput.files).slice(0, 5) : [];
        
        addLocation(locationData, photoFiles);
    });
    
    // Edit location form submission
    if (editLocationForm) {
        editLocationForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const locationId = editLocationId.value;
            
            // Get form data
            const locationData = {
                name: editLocationName.value.trim(),
                address: editLocationAddress.value.trim(),
                description: editLocationDescription.value.trim()
            };
            
            // Basic validation
            if (!locationData.name || !locationData.address) {
                showNotification('Please fill in all required fields', 'error');
                return;
            }
            
            // Check if we have coordinates
            if (!selectedLocation) {
                showNotification('Please select a location on the map', 'error');
                return;
            }
            
            // Add coordinates to location data
            locationData.latitude = selectedLocation.latitude;
            locationData.longitude = selectedLocation.longitude;
            
            // Get new photo files
            const newPhotoFiles = editLocationPhotosInput ? Array.from(editLocationPhotosInput.files).slice(0, 5) : [];
            
            await updateLocation(locationId, locationData, newPhotoFiles);
        });
    }
    
    // Handle ESC key to close modal
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape') {
            if (addLocationModal.style.display === 'block') {
                hideAddLocationModal();
            }
            if (editLocationModal && editLocationModal.style.display === 'block') {
                hideEditLocationModal();
            }
        }
    });
}

// Handle edit photo preview
function handleEditPhotoPreview(files) {
    if (!editPhotoPreview) return;
    
    editPhotoPreview.innerHTML = '';
    
    if (!files || files.length === 0) {
        return;
    }
    
    // Limit to 5 photos
    const filesToShow = Array.from(files).slice(0, 5);
    
    filesToShow.forEach((file, index) => {
        const reader = new FileReader();
        
        reader.onload = function(e) {
            const previewItem = document.createElement('div');
            previewItem.className = 'photo-preview-item';
            previewItem.innerHTML = `
                <img src="${e.target.result}" alt="Preview ${index + 1}">
                <button type="button" class="remove-photo-btn" data-index="${index}" title="Remove photo">×</button>
            `;
            editPhotoPreview.appendChild(previewItem);
            
            // Add remove button listener
            const removeBtn = previewItem.querySelector('.remove-photo-btn');
            removeBtn.addEventListener('click', function() {
                removeEditPhotoFromPreview(index);
            });
        };
        
        reader.readAsDataURL(file);
    });
    
    if (files.length > 5) {
        showNotification('Only the first 5 photos will be uploaded', 'info');
    }
}

// Remove photo from edit preview
function removeEditPhotoFromPreview(index) {
    const dt = new DataTransfer();
    const files = editLocationPhotosInput.files;
    
    for (let i = 0; i < files.length; i++) {
        if (i !== index) {
            dt.items.add(files[i]);
        }
    }
    
    editLocationPhotosInput.files = dt.files;
    handleEditPhotoPreview(dt.files);
}

// Geocode entered address when user doesn't select from suggestions
async function geocodeEnteredAddress() {
    const address = locationAddress.value.trim();
    if (!address) return;
    
    const coords = await geocodeAddress(address);
    if (coords) {
        selectedLocation = coords;
        
        // Add marker for geocoded address
        if (tempMarker) {
            map.removeLayer(tempMarker);
        }
        
        tempMarker = L.marker([coords.latitude, coords.longitude], {
            icon: L.divIcon({
                className: 'map-click-marker',
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            })
        }).addTo(map);
        
        updateCoordinatesDisplay(coords.latitude, coords.longitude);
        map.setView([coords.latitude, coords.longitude], 16);
        
        hideAddressSuggestions();
        document.getElementById('locationDescription').focus();
    } else {
        showNotification('Could not find coordinates for this address', 'error');
    }
}

// Get accuracy rating based on votes
function getAccuracyRating(upvotes, downvotes) {
    const totalVotes = upvotes + downvotes;
    
    if (totalVotes === 0) {
        return { text: 'Not rated', class: '' };
    }
    
    const ratio = upvotes / totalVotes;
    
    if (ratio >= 0.8) {
        return { text: 'Highly Accurate', class: 'accuracy-high' };
    } else if (ratio >= 0.6) {
        return { text: 'Moderately Accurate', class: 'accuracy-medium' };
    } else {
        return { text: 'Needs Verification', class: 'accuracy-low' };
    }
}

// Setup vote button listeners
function setupVoteButtonListeners() {
    document.querySelectorAll('.vote-btn').forEach(button => {
        button.addEventListener('click', async function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            const locationId = this.dataset.locationId;
            const voteType = this.dataset.voteType;
            
            await submitVote(locationId, voteType, this);
        });
    });
}

// Setup edit button listeners
function setupEditButtonListeners() {
    document.querySelectorAll('.edit-btn').forEach(button => {
        button.addEventListener('click', async function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            const locationId = this.dataset.locationId;
            const location = locations.find(loc => loc.id === locationId);
            if (location) {
                showEditLocationModal(location);
            }
        });
    });
}

// Setup delete button listeners
function setupDeleteButtonListeners() {
    document.querySelectorAll('.delete-btn').forEach(button => {
        button.addEventListener('click', async function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            const locationId = this.dataset.locationId;
            await confirmAndDeleteLocation(locationId);
        });
    });
}

// Setup maps button listeners
function setupMapsButtonListeners() {
    document.querySelectorAll('.maps-btn').forEach(button => {
        button.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            const lat = this.dataset.lat;
            const lng = this.dataset.lng;
            const name = decodeURIComponent(this.dataset.name || '');
            const address = decodeURIComponent(this.dataset.address);
            
            openInGoogleMaps(lat, lng, name, address);
        });
    });
}

// Open location in Google Maps
function openInGoogleMaps(lat, lng, name, address) {
    // Validate that we have either address or coordinates
    if (!address && (!lat || !lng)) {
        showNotification('Location information not available', 'error');
        return;
    }
    
    // Prefer address with business name for best context and business information
    let mapsUrl;
    if (address) {
        // Combine business name and address for optimal search results
        let searchQuery = address;
        if (name && name.trim() !== '') {
            // Add business name to the search for better results
            searchQuery = `${name}, ${address}`;
        }
        mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`;
    } else if (lat && lng) {
        // Fallback to coordinates if no address available
        mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
    } else {
        showNotification('Unable to open in maps - no location data available', 'error');
        return;
    }
    
    // Open in new tab
    try {
        window.open(mapsUrl, '_blank', 'noopener,noreferrer');
        showNotification('Opening in Google Maps...', 'success');
    } catch (error) {
        console.error('Error opening Google Maps:', error);
        showNotification('Unable to open Google Maps', 'error');
    }
}

// Submit vote to server
async function submitVote(locationId, voteType, buttonElement) {
    // Check if user is authenticated (only for Firebase mode)
    const user = getCurrentUser();
    const userId = user ? user.uid : null;
    
    // Check if user is signed in before allowing vote
    if (!userId) {
        showNotification('Please sign in to vote on locations', 'error');
        return;
    }
    
    try {
        // Add loading state
        buttonElement.disabled = true;
        
        const response = await fetch(`/api/locations/${locationId}/vote`, {
            method: 'POST',
            headers: await authHeaders(),
            body: JSON.stringify({ voteType, userId })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to submit vote');
        }
        
        const result = await response.json();
        
        // Update the location data
        const location = locations.find(loc => loc.id === locationId);
        if (location) {
            location.upvotes = result.upvotes;
            location.downvotes = result.downvotes;
        }
        
        // Update user's vote state
        userVotes[locationId] = result.userVote;
        
        // Refresh the display to show updated vote states
        filteredLocations = locations.filter(loc => 
            filteredLocations.some(filtered => filtered.id === loc.id)
        );
        displayLocations();
        
        // Show success notification
        let message;
        if (result.userVote === null) {
            message = '🗳️ Vote removed successfully!';
        } else {
            const voteTypeText = result.userVote === 'up' ? '👍' : '👎';
            message = `${voteTypeText} Vote recorded! Thank you for your feedback.`;
        }
        showNotification(message, 'success');
        
    } catch (error) {
        console.error('Error submitting vote:', error);
        showNotification('Failed to record vote. Please try again.', 'error');
    } finally {
        // Re-enable button
        buttonElement.disabled = false;
    }
}

// Load user's existing votes for all locations
async function loadUserVotes() {
    const user = getCurrentUser();
    if (!user) {
        userVotes = {};
        window.userVotes = userVotes;
        return;
    }
    
    try {
        // Load votes for all current locations
        const votePromises = locations.map(async (location) => {
            const response = await fetch(`/api/locations/${location.id}/vote/${user.uid}`);
            if (response.ok) {
                const result = await response.json();
                return { locationId: location.id, userVote: result.userVote };
            }
            return { locationId: location.id, userVote: null };
        });
        
        const votes = await Promise.all(votePromises);
        userVotes = {};
        votes.forEach(vote => {
            userVotes[vote.locationId] = vote.userVote;
        });
        
        // Update global reference
        window.userVotes = userVotes;
        
        // Refresh display to show vote states
        displayLocations();
        
    } catch (error) {
        console.error('Error loading user votes:', error);
        userVotes = {};
        window.userVotes = userVotes;
    }
}

// Make functions globally accessible
window.loadUserVotes = loadUserVotes;
window.displayLocations = displayLocations;

// Confirm and delete location with user verification
async function confirmAndDeleteLocation(locationId) {
    const location = locations.find(loc => loc.id === locationId);
    if (!location) {
        showNotification('Location not found', 'error');
        return;
    }
    
    // Confirm deletion
    const confirmed = confirm(
        `Are you sure you want to delete "${location.name}"?\n\n` +
        `This action cannot be undone and will remove:\n` +
        `• The location from the map\n` +
        `• All votes on this location\n` +
        `• Your contribution from the leaderboard`
    );
    
    if (!confirmed) {
        return;
    }
    
    await deleteLocation(locationId);
}

// Delete location from server
async function deleteLocation(locationId) {
    const user = getCurrentUser();
    if (!user) {
        showNotification('You must be signed in to delete locations', 'error');
        return;
    }
    
    try {
        showLoading(true);
        
        const response = await fetch(`/api/locations/${locationId}`, {
            method: 'DELETE',
            headers: await authHeaders(),
            body: JSON.stringify({ userId: user.uid })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to delete location');
        }
        
        // Remove from local arrays
        locations = locations.filter(loc => loc.id !== locationId);
        filteredLocations = filteredLocations.filter(loc => loc.id !== locationId);
        
        // Remove user vote for this location
        delete userVotes[locationId];
        window.userVotes = userVotes;
        
        // Update displays
        displayLocations();
        updateLocationCount();
        
        // Decrement user's location count and update leaderboard
        if (isAuthenticated()) {
            await decrementUserLocationCount(user.uid);
        }
        
        showNotification('Location deleted successfully', 'success');
        
    } catch (error) {
        console.error('Error deleting location:', error);
        showNotification(error.message || 'Failed to delete location', 'error');
    } finally {
        showLoading(false);
    }
}

// Show edit location modal
function showEditLocationModal(location) {
    editingLocation = location;
    photosToRemove = [];
    
    // Populate form fields
    editLocationId.value = location.id;
    editLocationName.value = location.name;
    editLocationAddress.value = location.address;
    editLocationDescription.value = location.description || '';
    
    // Set coordinates
    selectedLocation = {
        latitude: location.latitude,
        longitude: location.longitude
    };
    
    // Update coordinates display
    updateEditCoordinatesDisplay(location.latitude, location.longitude);
    
    // Display current photos
    displayCurrentPhotos(location.photos || []);
    
    // Clear new photo selections
    if (editLocationPhotosInput) {
        editLocationPhotosInput.value = '';
    }
    if (editPhotoPreview) {
        editPhotoPreview.innerHTML = '';
    }
    
    // Show modal
    editLocationModal.style.display = 'block';
    editLocationName.focus();
}

// Hide edit location modal
function hideEditLocationModal() {
    editLocationModal.style.display = 'none';
    editLocationForm.reset();
    editingLocation = null;
    photosToRemove = [];
    selectedLocation = null;
    
    if (editPhotoPreview) {
        editPhotoPreview.innerHTML = '';
    }
    if (editCurrentPhotos) {
        editCurrentPhotos.innerHTML = '';
    }
    
    // Reset coordinates display
    editLocationCoordinates.textContent = 'Right-click on the map (or long press on mobile) to update location';
    editLocationCoordinates.classList.remove('has-location');
    editClearLocationBtn.style.display = 'none';
}

// Update edit coordinates display
function updateEditCoordinatesDisplay(lat, lng) {
    editLocationCoordinates.textContent = `📍 Selected: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    editLocationCoordinates.classList.add('has-location');
    editClearLocationBtn.style.display = 'inline-block';
}

// Display current photos with remove option
function displayCurrentPhotos(photos) {
    if (!editCurrentPhotos) return;
    
    editCurrentPhotos.innerHTML = '';
    
    if (!photos || photos.length === 0) {
        editCurrentPhotos.innerHTML = '<p class="no-photos">No photos yet</p>';
        return;
    }
    
    const photosContainer = document.createElement('div');
    photosContainer.className = 'current-photos-grid';
    
    photos.forEach((photo, index) => {
        // Support both old format (string) and new format (object with thumb/full)
        const displayURL = typeof photo === 'string' ? photo : (photo.thumb || photo.full);
        const photoData = typeof photo === 'string' ? photo : JSON.stringify(photo);
        
        const photoItem = document.createElement('div');
        photoItem.className = 'current-photo-item';
        photoItem.innerHTML = `
            <img src="${displayURL}" alt="Location photo ${index + 1}">
            <button type="button" class="remove-current-photo-btn" data-photo-data="${encodeURIComponent(photoData)}" title="Remove photo">×</button>
        `;
        
        // Add remove button listener
        const removeBtn = photoItem.querySelector('.remove-current-photo-btn');
        removeBtn.addEventListener('click', function() {
            removeCurrentPhoto(photo, photoItem);
        });
        
        photosContainer.appendChild(photoItem);
    });
    
    editCurrentPhotos.appendChild(photosContainer);
}

// Remove current photo
function removeCurrentPhoto(photo, photoElement) {
    // Add to removal list (store the full photo data)
    if (!photosToRemove.some(p => JSON.stringify(p) === JSON.stringify(photo))) {
        photosToRemove.push(photo);
    }
    
    // Mark as removed in UI
    photoElement.classList.add('photo-removed');
    const img = photoElement.querySelector('img');
    if (img) {
        img.style.opacity = '0.3';
    }
    
    const removeBtn = photoElement.querySelector('.remove-current-photo-btn');
    if (removeBtn) {
        removeBtn.textContent = '↶';
        removeBtn.title = 'Undo remove';
        removeBtn.onclick = function() {
            undoRemovePhoto(photo, photoElement);
        };
    }
}

// Undo remove photo
function undoRemovePhoto(photo, photoElement) {
    // Remove from removal list
    const index = photosToRemove.findIndex(p => JSON.stringify(p) === JSON.stringify(photo));
    if (index > -1) {
        photosToRemove.splice(index, 1);
    }
    
    // Restore in UI
    photoElement.classList.remove('photo-removed');
    const img = photoElement.querySelector('img');
    if (img) {
        img.style.opacity = '1';
    }
    
    const removeBtn = photoElement.querySelector('.remove-current-photo-btn');
    if (removeBtn) {
        removeBtn.textContent = '×';
        removeBtn.title = 'Remove photo';
        removeBtn.onclick = function() {
            removeCurrentPhoto(photo, photoElement);
        };
    }
}

// Update location
async function updateLocation(locationId, locationData, newPhotoFiles) {
    const user = getCurrentUser();
    if (!user) {
        showNotification('You must be signed in to edit locations', 'error');
        return;
    }
    
    showLoading(true);
    try {
        // Prepare update data
        const updateData = {
            ...locationData,
            userId: user.uid,
            photosToRemove: photosToRemove
        };
        
        // Update location details
        const response = await fetch(`/api/locations/${locationId}`, {
            method: 'PUT',
            headers: await authHeaders(),
            body: JSON.stringify(updateData)
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to update location');
        }
        
        let updatedLocation = await response.json();
        
        // Upload new photos if any
        if (newPhotoFiles && newPhotoFiles.length > 0) {
            try {
                showNotification(`Processing and uploading ${newPhotoFiles.length} new photo(s)...`, 'info');
                const photoURLs = await uploadLocationPhotos(locationId, newPhotoFiles);
                
                if (photoURLs.length > 0) {
                    // Add new photos to location
                    const photoResponse = await fetch(`/api/locations/${locationId}/photos`, {
                        method: 'POST',
                        headers: await authHeaders(),
                        body: JSON.stringify({ photoURLs })
                    });
                    
                    if (photoResponse.ok) {
                        const photoResult = await photoResponse.json();
                        updatedLocation.photos = photoResult.photos;
                        showNotification(`${photoURLs.length} new photo(s) uploaded!`, 'success');
                    }
                }
            } catch (photoError) {
                console.error('Error uploading new photos:', photoError);
                showNotification('Location updated but some photos failed to upload', 'warning');
            }
        }
        
        // Update local data
        const index = locations.findIndex(loc => loc.id === locationId);
        if (index !== -1) {
            locations[index] = updatedLocation;
            filteredLocations = locations.filter(loc => 
                filteredLocations.some(filtered => filtered.id === loc.id)
            );
        }
        
        displayLocations();
        hideEditLocationModal();
        
        showNotification('Location updated successfully!', 'success');
        
        // Zoom to updated location
        map.setView([updatedLocation.latitude, updatedLocation.longitude], 15);
        highlightLocation(updatedLocation.id);
        
    } catch (error) {
        console.error('Error updating location:', error);
        showNotification(error.message, 'error');
    } finally {
        showLoading(false);
    }
}

// Helper function to determine if query is business-related
function isBusinessQuery(query) {
    const businessKeywords = [
        'cafe', 'coffee', 'restaurant', 'shop', 'store', 'mall', 'hotel', 
        'bank', 'pharmacy', 'supermarket', 'market', 'clinic', 'hospital',
        'gym', 'spa', 'salon', 'bar', 'pub', 'club', 'theatre', 'cinema'
    ];
    
    return businessKeywords.some(keyword => 
        query.toLowerCase().includes(keyword)
    );
}

// Sort suggestions by relevance to query
function sortSuggestionsByRelevance(suggestions, query) {
    return suggestions.sort((a, b) => {
        const scoreA = calculateRelevanceScore(a, query);
        const scoreB = calculateRelevanceScore(b, query);
        return scoreB - scoreA;
    });
}

// Calculate relevance score for a suggestion
function calculateRelevanceScore(suggestion, query) {
    let score = 0;
    const queryLower = query.toLowerCase();
    const displayName = suggestion.display_name.toLowerCase();
    const type = suggestion.type || '';
    const className = suggestion.class || '';
    
    // Exact name match gets highest score
    if (displayName.startsWith(queryLower)) {
        score += 100;
    }
    
    // Partial name match
    if (displayName.includes(queryLower)) {
        score += 50;
    }
    
    // Business/amenity types get higher scores
    if (className === 'amenity' || className === 'shop' || className === 'leisure') {
        score += 30;
    }
    
    // Specific place types
    if (type === 'restaurant' || type === 'cafe' || type === 'shop' || type === 'bank') {
        score += 20;
    }
    
    // Address matches get lower scores
    if (className === 'highway' || type === 'residential') {
        score -= 10;
    }
    
    return score;
}

// Analyze suggestion to determine display information
function analyzeSuggestion(suggestion) {
    const type = suggestion.type || '';
    const className = suggestion.class || '';
    const displayName = suggestion.display_name;
    
    // Extract the main name (before the first comma)
    const mainName = displayName.split(',')[0].trim();
    const address = displayName.split(',').slice(1).join(',').trim();
    
    let icon = '📍'; // default location icon
    let title = mainName;
    let subtitle = address;
    
    // Determine icon and formatting based on place type
    if (className === 'amenity') {
        switch (type) {
            case 'restaurant':
                icon = '🍽️';
                break;
            case 'cafe':
                icon = '☕';
                break;
            case 'bank':
                icon = '🏦';
                break;
            case 'hospital':
                icon = '🏥';
                break;
            case 'pharmacy':
                icon = '💊';
                break;
            case 'fuel':
                icon = '⛽';
                break;
            case 'school':
                icon = '🏫';
                break;
            case 'place_of_worship':
                icon = '🏛️';
                break;
            default:
                icon = '🏢';
        }
    } else if (className === 'shop') {
        switch (type) {
            case 'supermarket':
                icon = '🛒';
                break;
            case 'clothes':
                icon = '👕';
                break;
            case 'electronics':
                icon = '📱';
                break;
            case 'books':
                icon = '📚';
                break;
            default:
                icon = '🏪';
        }
    } else if (className === 'leisure') {
        switch (type) {
            case 'park':
                icon = '🌳';
                break;
            case 'sports_centre':
                icon = '🏃';
                break;
            case 'swimming_pool':
                icon = '🏊';
                break;
            default:
                icon = '🎯';
        }
    } else if (className === 'tourism') {
        switch (type) {
            case 'hotel':
                icon = '🏨';
                break;
            case 'attraction':
                icon = '🎡';
                break;
            case 'museum':
                icon = '🏛️';
                break;
            default:
                icon = '🗺️';
        }
    } else if (className === 'place') {
        icon = '🏙️';
    }
    
    // Format business names vs addresses differently
    if (className === 'amenity' || className === 'shop' || className === 'leisure' || className === 'tourism') {
        title = `${mainName}`;
        subtitle = `${getPlaceTypeLabel(className, type)} • ${address}`;
    }
    
    return { icon, title, subtitle };
}

// Get user-friendly label for place types
function getPlaceTypeLabel(className, type) {
    const labels = {
        'amenity': {
            'restaurant': 'Restaurant',
            'cafe': 'Cafe',
            'bank': 'Bank',
            'hospital': 'Hospital',
            'pharmacy': 'Pharmacy',
            'fuel': 'Gas Station',
            'school': 'School',
            'place_of_worship': 'Place of Worship'
        },
        'shop': {
            'supermarket': 'Supermarket',
            'clothes': 'Clothing Store',
            'electronics': 'Electronics Store',
            'books': 'Bookstore'
        },
        'leisure': {
            'park': 'Park',
            'sports_centre': 'Sports Center',
            'swimming_pool': 'Swimming Pool'
        },
        'tourism': {
            'hotel': 'Hotel',
            'attraction': 'Tourist Attraction',
            'museum': 'Museum'
        }
    };
    
    return labels[className]?.[type] || (type ? type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'Location');
}

// Setup authentication event listeners
function setupAuthEventListeners() {
    const authButton = document.getElementById('authButton');
    const authModal = document.getElementById('authModal');
    const authModalClose = document.getElementById('authModalClose');
    
    // Show auth modal
    if (authButton) {
        authButton.addEventListener('click', () => {
            authModal.style.display = 'block';
        });
    }
    
    // Close auth modal
    if (authModalClose) {
        authModalClose.addEventListener('click', () => {
            authModal.style.display = 'none';
        });
    }
    
    // Close modal when clicking outside
    window.addEventListener('click', (event) => {
        if (event.target === authModal) {
            authModal.style.display = 'none';
        }
    });
    
    // Google sign-in buttons
    const googleSignInBtn = document.getElementById('googleSignInBtn');
    const googleSignUpBtn = document.getElementById('googleSignUpBtn');
    
    if (googleSignInBtn) {
        googleSignInBtn.addEventListener('click', handleGoogleSignIn);
    }
    
    if (googleSignUpBtn) {
        googleSignUpBtn.addEventListener('click', handleGoogleSignIn);
    }
    
    // Email sign-in form
    const emailSignInForm = document.getElementById('emailSignInForm');
    if (emailSignInForm) {
        emailSignInForm.addEventListener('submit', handleEmailSignIn);
    }
    
    // Email sign-up form
    const emailSignUpForm = document.getElementById('emailSignUpForm');
    if (emailSignUpForm) {
        emailSignUpForm.addEventListener('submit', handleEmailSignUp);
    }
    
    // Nickname form
    const nicknameForm = document.getElementById('nicknameForm');
    if (nicknameForm) {
        nicknameForm.addEventListener('submit', handleNicknameSubmit);
    }
}

// Handle Google sign-in
async function handleGoogleSignIn() {
    const result = await signInWithGoogle();
    if (result.success) {
        document.getElementById('authModal').style.display = 'none';
    }
}

// Handle email sign-in
async function handleEmailSignIn(event) {
    event.preventDefault();
    
    const email = document.getElementById('signinEmail').value;
    const password = document.getElementById('signinPassword').value;
    
    const result = await signInWithEmail(email, password);
    if (result.success) {
        document.getElementById('authModal').style.display = 'none';
    }
}

// Handle email sign-up
async function handleEmailSignUp(event) {
    event.preventDefault();
    
    const nickname = document.getElementById('signupNickname').value;
    const email = document.getElementById('signupEmail').value;
    const password = document.getElementById('signupPassword').value;
    
    const result = await signUpWithEmail(email, password, nickname);
    if (result.success) {
        document.getElementById('authModal').style.display = 'none';
    }
}

// Handle nickname submission
async function handleNicknameSubmit(event) {
    event.preventDefault();
    
    const nickname = document.getElementById('userNickname').value.trim();
    
    if (!nickname) {
        showNotification('Please enter a nickname', 'error');
        return;
    }
    
    const user = getCurrentUser();
    if (user) {
        try {
            // Update user profile with nickname (this function needs to be implemented)
            await updateUserNickname(user.uid, nickname);
            document.getElementById('nicknameModal').style.display = 'none';
            showNotification('Profile updated successfully!', 'success');
        } catch (error) {
            showNotification('Failed to update profile', 'error');
        }
    }
}

// Switch authentication tabs
window.switchAuthTab = function(tab) {
    const signinTab = document.getElementById('signinTab');
    const signupTab = document.getElementById('signupTab');
    const signinForm = document.getElementById('signinForm');
    const signupForm = document.getElementById('signupForm');
    
    if (tab === 'signin') {
        signinTab.classList.add('active');
        signupTab.classList.remove('active');
        signinForm.style.display = 'block';
        signupForm.style.display = 'none';
    } else {
        signupTab.classList.add('active');
        signinTab.classList.remove('active');
        signupForm.style.display = 'block';
        signinForm.style.display = 'none';
    }
};

// Photo Viewer functionality
let currentPhotoGallery = [];
let currentPhotoIndex = 0;

const photoViewerModal = document.getElementById('photoViewerModal');
const photoViewerImage = document.getElementById('photoViewerImage');
const photoCounter = document.getElementById('photoCounter');
const photoPrevBtn = document.getElementById('photoPrevBtn');
const photoNextBtn = document.getElementById('photoNextBtn');
const photoViewerClose = document.querySelector('.photo-viewer-close');

function openPhotoViewer(photos, startIndex = 0) {
    currentPhotoGallery = photos;
    currentPhotoIndex = startIndex;
    showCurrentPhoto();
    photoViewerModal.style.display = 'block';
    document.body.style.overflow = 'hidden'; // Prevent background scrolling
}

function closePhotoViewer() {
    photoViewerModal.style.display = 'none';
    document.body.style.overflow = ''; // Restore scrolling
    currentPhotoGallery = [];
    currentPhotoIndex = 0;
}

function showCurrentPhoto() {
    if (currentPhotoGallery.length === 0) return;
    
    photoViewerImage.src = currentPhotoGallery[currentPhotoIndex];
    photoCounter.textContent = `${currentPhotoIndex + 1} / ${currentPhotoGallery.length}`;
    
    // Update button states
    photoPrevBtn.disabled = currentPhotoIndex === 0;
    photoNextBtn.disabled = currentPhotoIndex === currentPhotoGallery.length - 1;
}

function showPreviousPhoto() {
    if (currentPhotoIndex > 0) {
        currentPhotoIndex--;
        showCurrentPhoto();
    }
}

function showNextPhoto() {
    if (currentPhotoIndex < currentPhotoGallery.length - 1) {
        currentPhotoIndex++;
        showCurrentPhoto();
    }
}

// Event listeners for photo viewer
photoViewerClose.addEventListener('click', closePhotoViewer);
photoPrevBtn.addEventListener('click', showPreviousPhoto);
photoNextBtn.addEventListener('click', showNextPhoto);

// Close on background click
photoViewerModal.addEventListener('click', function(e) {
    if (e.target === photoViewerModal) {
        closePhotoViewer();
    }
});

// Keyboard navigation
document.addEventListener('keydown', function(e) {
    if (photoViewerModal.style.display === 'block') {
        if (e.key === 'Escape') {
            closePhotoViewer();
        } else if (e.key === 'ArrowLeft') {
            showPreviousPhoto();
        } else if (e.key === 'ArrowRight') {
            showNextPhoto();
        }
    }
});

// Setup photo click listeners (needs to be called after locations are displayed)
function setupPhotoClickListeners() {
    document.querySelectorAll('.popup-photo').forEach(img => {
        // Make element explicitly tappable for iOS Safari
        img.style.webkitTapHighlightColor = 'transparent';
        
        const handlePhotoClick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            const locationId = this.dataset.locationId;
            const photoIndex = parseInt(this.dataset.photoIndex);
            const location = locations.find(loc => loc.id === locationId);
            
            if (location && location.photos) {
                // Extract full URLs from photos (support both old and new format)
                const fullPhotoURLs = location.photos.map(photo => 
                    typeof photo === 'string' ? photo : photo.full
                );
                openPhotoViewer(fullPhotoURLs, photoIndex);
            }
        };
        
        // Add both click and touchend for better mobile support
        img.addEventListener('click', handlePhotoClick);
        img.addEventListener('touchend', handlePhotoClick, { passive: false });
    });
}

// Setup list photo click listeners (for location list thumbnails)
function setupListPhotoClickListeners() {
    document.querySelectorAll('.location-photo-thumb').forEach(img => {
        // Make element explicitly tappable for iOS Safari
        img.style.cursor = 'pointer';
        img.style.webkitTapHighlightColor = 'transparent';
        
        const handlePhotoClick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            const locationId = this.dataset.locationId;
            const location = locations.find(loc => loc.id === locationId);
            
            if (location && location.photos) {
                // Extract full URLs from photos (support both old and new format)
                const fullPhotoURLs = location.photos.map(photo => 
                    typeof photo === 'string' ? photo : photo.full
                );
                // Always start from index 0 (first photo)
                openPhotoViewer(fullPhotoURLs, 0);
            }
        };
        
        // Add both click and touchend for better mobile support
        img.addEventListener('click', handlePhotoClick);
        img.addEventListener('touchend', handlePhotoClick, { passive: false });
    });
}

