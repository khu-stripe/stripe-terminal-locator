// Supabase Authentication Configuration (Client-side)
// Credentials are loaded from the server at runtime via /api/config

let supabase = null;
let supabaseInitialized = false;

async function loadSupabaseConfig() {
    try {
        const res = await fetch('/api/config');
        const config = await res.json();

        if (!config.supabaseUrl || !config.supabaseAnonKey) {
            console.log('Supabase client configuration incomplete - authentication disabled');
            return;
        }

        const { createClient } = window.supabase;
        supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
        supabaseInitialized = true;
        console.log('Supabase client initialized successfully');
    } catch (error) {
        console.error('Supabase client initialization failed:', error.message);
        supabaseInitialized = false;
    }
}

// Global authentication state
let currentUser = null;
let userProfile = null;

const DEFAULT_AVATAR = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMjAiIGZpbGw9IiM2NjdlZWEiLz4KPHBhdGggZD0iTTIwIDIyYzMuMzEzNyAwIDYtMi42ODYzIDYtNnMtMi42ODYzLTYtNi02cy02IDIuNjg2My02IDZTMTYuNjg2MyAyMiAyMCAyMnpNMjAgMjRjLTQuNjY2NyAwLTEzIDIuMzMzMy0xMyA3djNIMzN2LTNDMzMgMjYuMzMzMyAyNC42NjY3IDI0IDIwIDI0eiIgZmlsbD0id2hpdGUiLz4KPC9zdmc+';

function getSafeAvatarUrl(photoURL) {
    if (!photoURL) return DEFAULT_AVATAR;
    if (photoURL.includes('googleusercontent.com')) {
        return photoURL.replace(/=s\d+-c$/, '') + '=s64-c';
    }
    return photoURL;
}

// Initialize authentication
export async function initializeAuth() {
    console.log('Initializing Authentication System...');

    await loadSupabaseConfig();
    handleReferralCodeInURL();

    if (!supabaseInitialized) {
        console.log('Supabase not configured - running in local mode');
        updateAuthUI(false);
        updateLocationFormVisibility();
        return;
    }

    // Restore existing session from localStorage on page load
    const { data: { session } } = await supabase.auth.getSession();
    await handleAuthSession(session);

    // Listen for future authentication state changes (sign-in, sign-out, token refresh)
    supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === 'INITIAL_SESSION') return;
        await handleAuthSession(session);
    });
}

async function handleAuthSession(session) {
    if (session && session.user) {
        currentUser = session.user;
        console.log('User signed in:', currentUser.email);
        await loadUserProfile(currentUser.id);
        updateAuthUI(true);

        if (!userProfile.nickname) {
            showNicknameModal();
        }

        if (window.loadUserVotes) {
            await window.loadUserVotes();
        }

        if (window.displayLocations) {
            window.displayLocations();
        }
    } else {
        console.log('User signed out');
        currentUser = null;
        userProfile = null;
        updateAuthUI(false);

        if (window.userVotes) {
            window.userVotes = {};
        }

        if (window.map) {
            window.map.closePopup();
        }

        setTimeout(() => {
            if (window.displayLocations) {
                window.displayLocations();
            }
        }, 0);
    }

    updateLocationFormVisibility();
    updateLeaderboard();
}

// Load user profile from Supabase
async function loadUserProfile(uid) {
    try {
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('id', uid)
            .single();

        if (data) {
            userProfile = {
                id: uid,
                email: data.email,
                nickname: data.nickname || '',
                displayName: data.display_name || '',
                photoURL: data.photo_url || '',
                locationsCreated: data.locations_created || 0,
                referralCount: data.referral_count || 0,
                referralCode: data.referral_code || '',
                createdAt: data.created_at
            };
        } else {
            // Profile should be auto-created by DB trigger, but handle edge case
            userProfile = {
                id: uid,
                email: currentUser.email,
                nickname: '',
                displayName: currentUser.user_metadata?.full_name || '',
                photoURL: currentUser.user_metadata?.avatar_url || '',
                locationsCreated: 0,
                referralCount: 0,
                createdAt: new Date().toISOString()
            };

            await supabase.from('users').upsert({
                id: uid,
                email: currentUser.email,
                display_name: currentUser.user_metadata?.full_name || '',
                photo_url: currentUser.user_metadata?.avatar_url || ''
            });

            await processNewUserReferral(uid);
        }
    } catch (error) {
        console.error('Error loading user profile:', error);
    }
}

// Process referral code for new user
async function processNewUserReferral(userId) {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        let referralCode = urlParams.get('ref') || urlParams.get('referral');

        if (!referralCode) {
            referralCode = localStorage.getItem('pendingReferralCode');
        }

        if (referralCode) {
            const result = await processReferralCode(userId, referralCode);
            if (result && result.success) {
                showNotification(`Welcome! You were referred by ${result.referrerNickname}`, 'success');
                localStorage.removeItem('pendingReferralCode');
                if (window.history.replaceState) {
                    const url = new URL(window.location);
                    url.searchParams.delete('ref');
                    url.searchParams.delete('referral');
                    window.history.replaceState({}, document.title, url.pathname + url.search);
                }
            }
        }
    } catch (error) {
        console.error('Error processing referral for new user:', error);
    }
}

// Sign in with Google
export async function signInWithGoogle() {
    if (!supabaseInitialized) {
        showNotification('Authentication not available. Please configure Supabase first.', 'error');
        return { success: false, error: new Error('Supabase not configured') };
    }

    try {
        showLoading('Signing in with Google...');
        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: window.location.origin
            }
        });

        if (error) throw error;

        hideLoading();
        return { success: true, data };
    } catch (error) {
        console.error('Google sign-in failed:', error);
        hideLoading();
        showNotification('Failed to sign in with Google: ' + error.message, 'error');
        return { success: false, error };
    }
}

// Sign up with email and password
export async function signUpWithEmail(email, password, nickname) {
    if (!supabaseInitialized) {
        showNotification('Authentication not available. Please configure Supabase first.', 'error');
        return { success: false, error: new Error('Supabase not configured') };
    }

    try {
        showLoading('Creating account...');
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: { full_name: nickname }
            }
        });

        if (error) throw error;

        // Update nickname in users table
        if (data.user) {
            await supabase.from('users').update({ nickname }).eq('id', data.user.id);
        }

        hideLoading();
        return { success: true, user: data.user };
    } catch (error) {
        console.error('Email sign-up failed:', error);
        hideLoading();
        showNotification('Failed to create account: ' + error.message, 'error');
        return { success: false, error };
    }
}

// Sign in with email and password
export async function signInWithEmail(email, password) {
    if (!supabaseInitialized) {
        showNotification('Authentication not available. Please configure Supabase first.', 'error');
        return { success: false, error: new Error('Supabase not configured') };
    }

    try {
        showLoading('Signing in...');
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });

        if (error) throw error;

        hideLoading();
        return { success: true, user: data.user };
    } catch (error) {
        console.error('Email sign-in failed:', error);
        hideLoading();
        showNotification('Failed to sign in: ' + error.message, 'error');
        return { success: false, error };
    }
}

// Sign out
export async function signOutUser() {
    if (!supabaseInitialized) {
        showNotification('Authentication not available', 'error');
        return;
    }

    try {
        await supabase.auth.signOut();
        showNotification('Signed out successfully', 'success');
    } catch (error) {
        console.error('Sign out failed:', error);
        showNotification('Failed to sign out: ' + error.message, 'error');
    }
}

// Update user nickname
export async function updateUserNickname(uid, nickname) {
    try {
        const { error } = await supabase
            .from('users')
            .update({ nickname })
            .eq('id', uid);

        if (error) throw error;

        if (userProfile) userProfile.nickname = nickname;
        return true;
    } catch (error) {
        console.error('Failed to update user profile:', error);
        return false;
    }
}

// Decrement user's location count
export async function decrementUserLocationCount(uid) {
    try {
        const { data: user } = await supabase
            .from('users')
            .select('locations_created')
            .eq('id', uid)
            .single();

        if (user) {
            await supabase
                .from('users')
                .update({ locations_created: Math.max(0, (user.locations_created || 1) - 1) })
                .eq('id', uid);
        }

        if (userProfile && userProfile.id === uid) {
            userProfile.locationsCreated = Math.max(0, (userProfile.locationsCreated || 1) - 1);
            updateAuthUI(true);
        }
    } catch (error) {
        console.error('Failed to decrement location count:', error);
    }
}

// Increment user's location count
export async function incrementUserLocationCount(uid) {
    try {
        const { data: user } = await supabase
            .from('users')
            .select('locations_created')
            .eq('id', uid)
            .single();

        if (user) {
            await supabase
                .from('users')
                .update({ locations_created: (user.locations_created || 0) + 1 })
                .eq('id', uid);
        }

        if (userProfile && userProfile.id === uid) {
            userProfile.locationsCreated = (userProfile.locationsCreated || 0) + 1;
            updateAuthUI(true);
        }
    } catch (error) {
        console.error('Failed to increment location count:', error);
    }
}

// Get leaderboard data
export async function getLeaderboard(limitCount = 10) {
    if (!supabaseInitialized) return [];

    try {
        const { data, error } = await supabase
            .from('users')
            .select('id, nickname, display_name, email, locations_created, photo_url')
            .gt('locations_created', 0)
            .order('locations_created', { ascending: false })
            .limit(limitCount);

        if (error) throw error;

        return (data || []).map(user => ({
            id: user.id,
            nickname: user.nickname || user.display_name || user.email || 'Unknown User',
            locationsCreated: user.locations_created || 0,
            photoURL: user.photo_url || ''
        }));
    } catch (error) {
        console.error('Failed to get leaderboard:', error);
        return [];
    }
}

// Get referral leaderboard data
export async function getReferralLeaderboard(limitCount = 10) {
    try {
        const response = await fetch(`/api/referrals/leaderboard?limit=${limitCount}`);
        if (!response.ok) throw new Error('Failed to fetch referral leaderboard');
        return await response.json();
    } catch (error) {
        console.error('Failed to get referral leaderboard:', error);
        return [];
    }
}

// Get user's referral code
export async function getUserReferralCode(userId) {
    try {
        const response = await fetch(`/api/users/${userId}/referral-code`);
        if (!response.ok) throw new Error('Failed to fetch referral code');
        return await response.json();
    } catch (error) {
        console.error('Failed to get referral code:', error);
        return null;
    }
}

// Generate new referral code
export async function generateNewReferralCode(userId) {
    try {
        const response = await fetch(`/api/users/${userId}/referral-code`, {
            method: 'POST',
            headers: await authHeaders()
        });
        if (!response.ok) throw new Error('Failed to generate referral code');
        return await response.json();
    } catch (error) {
        console.error('Failed to generate referral code:', error);
        return null;
    }
}

// Process referral code
export async function processReferralCode(userId, referralCode) {
    try {
        const response = await fetch('/api/users/process-referral', {
            method: 'POST',
            headers: await authHeaders(),
            body: JSON.stringify({ userId, referralCode })
        });
        if (!response.ok) throw new Error('Failed to process referral');
        return await response.json();
    } catch (error) {
        console.error('Failed to process referral:', error);
        return null;
    }
}

// Get current user info (expose .uid for backward compatibility with app.js)
export function getCurrentUser() {
    if (!currentUser) return null;
    if (!currentUser.uid) currentUser.uid = currentUser.id;
    return currentUser;
}

export function getCurrentUserProfile() {
    return userProfile;
}

export function isAuthenticated() {
    return supabaseInitialized && currentUser !== null;
}

// Update authentication UI
function updateAuthUI(isSignedIn) {
    const authButton = document.getElementById('authButton');
    const userInfo = document.getElementById('userInfo');
    const addLocationBtn = document.getElementById('addLocationBtn');

    if (!supabaseInitialized) {
        if (authButton) {
            authButton.style.display = 'block';
            authButton.innerHTML = 'Setup Required';
            authButton.disabled = true;
        }
        if (userInfo) userInfo.style.display = 'none';
        if (addLocationBtn) {
            addLocationBtn.style.display = 'block';
            addLocationBtn.innerHTML = 'Add Location (Local Mode)';
            addLocationBtn.disabled = false;
        }
        return;
    }

    if (isSignedIn && userProfile) {
        if (authButton) authButton.style.display = 'none';
        if (userInfo) {
            userInfo.style.display = 'flex';
            userInfo.innerHTML = `
                <div class="user-profile">
                    <img src="${getSafeAvatarUrl(userProfile.photoURL)}" alt="Profile" class="user-avatar"
                         title="Profile photo for ${userProfile.nickname || userProfile.displayName || 'User'}"
                         onerror="this.src='${DEFAULT_AVATAR}'; this.onerror=null;">
                    <div class="user-details">
                        <span class="user-nickname">${userProfile.nickname || userProfile.displayName || 'User'}</span>
                        <span class="user-stats">${userProfile.locationsCreated || 0} locations &bull; <a href="/referrals.html" class="referral-link">${userProfile.referralCount || 0} referrals</a></span>
                    </div>
                    <button id="signOutBtn" class="btn btn-secondary btn-small">Sign Out</button>
                </div>
            `;

            const signOutBtn = document.getElementById('signOutBtn');
            if (signOutBtn) {
                signOutBtn.addEventListener('click', signOutUser);
            }
        }

        if (addLocationBtn) {
            addLocationBtn.style.display = 'block';
            addLocationBtn.innerHTML = 'Add New Location';
            addLocationBtn.disabled = false;
        }
    } else {
        if (authButton) {
            authButton.style.display = 'block';
            authButton.innerHTML = 'Sign In';
            authButton.disabled = false;
        }
        if (userInfo) userInfo.style.display = 'none';
        if (addLocationBtn) {
            addLocationBtn.style.display = 'none';
        }
    }
}

function updateLocationFormVisibility() {
    const addLocationBtn = document.getElementById('addLocationBtn');
    const addLocationHint = document.getElementById('addLocationHint');
    if (addLocationBtn) {
        if (isAuthenticated()) {
            addLocationBtn.style.display = 'block';
            addLocationBtn.disabled = false;
            if (addLocationHint) addLocationHint.textContent = 'or right-click on map';
        } else {
            addLocationBtn.style.display = 'none';
            addLocationBtn.disabled = true;
            if (addLocationHint) addLocationHint.textContent = 'Sign in to add a location';
        }
    }
}

function showNicknameModal() {
    const modal = document.getElementById('nicknameModal');
    if (modal) modal.style.display = 'block';
}

// Update leaderboard display
export async function updateLeaderboard() {
    const leaderboardContainer = document.getElementById('leaderboardContainer');
    if (!leaderboardContainer) return;

    try {
        const leaderboard = await getLeaderboard(10);
        displayLeaderboard(leaderboard);
    } catch (error) {
        console.error('Error updating leaderboard:', error);
    }
}

function displayLeaderboard(leaderboard) {
    const leaderboardList = document.getElementById('locationsLeaderboardList');
    if (!leaderboardList) return;

    if (leaderboard.length === 0) {
        leaderboardList.innerHTML = '<div class="no-data">No users on leaderboard yet</div>';
        return;
    }

    leaderboardList.innerHTML = leaderboard.map((user, index) => {
        const rank = index + 1;
        const isCurrentUser = userProfile && user.id === userProfile.id;
        const safeAvatarUrl = getSafeAvatarUrl(user.photoURL);

        return `
            <div class="leaderboard-item ${isCurrentUser ? 'current-user' : ''}">
                <div class="rank">#${rank}</div>
                <div class="user-info">
                    <img src="${safeAvatarUrl}" alt="${user.nickname} avatar" class="avatar"
                         onerror="this.src='${DEFAULT_AVATAR}'; this.onerror=null;">
                    <div class="user-details">
                        <span class="nickname">${user.nickname}</span>
                        <span class="locations-count">${user.locationsCreated} location${user.locationsCreated !== 1 ? 's' : ''}</span>
                    </div>
                </div>
                ${isCurrentUser ? '<span class="current-user-badge">You</span>' : ''}
            </div>
        `;
    }).join('');
}

function handleReferralCodeInURL() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const referralCode = urlParams.get('ref') || urlParams.get('referral');

        if (referralCode) {
            localStorage.setItem('pendingReferralCode', referralCode);
            showNotification("You've been invited to join! Sign up to get started.", 'info');
        }
    } catch (error) {
        console.error('Error handling referral code in URL:', error);
    }
}

// Image Compression Utility
async function compressImage(file, maxWidth = 1200, maxHeight = 1200, quality = 0.8) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function(e) {
            const img = new Image();
            img.onload = function() {
                let width = img.width;
                let height = img.height;

                if (width > maxWidth || height > maxHeight) {
                    const ratio = Math.min(maxWidth / width, maxHeight / height);
                    width = Math.floor(width * ratio);
                    height = Math.floor(height * ratio);
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob(
                    (blob) => {
                        if (blob) {
                            const compressedFile = new File([blob], file.name, { type: 'image/jpeg', lastModified: Date.now() });
                            resolve(compressedFile);
                        } else {
                            reject(new Error('Failed to compress image'));
                        }
                    },
                    'image/jpeg',
                    quality
                );
            };
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = e.target.result;
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}

async function generateThumbnail(file, maxWidth = 150, maxHeight = 150, quality = 0.6) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function(e) {
            const img = new Image();
            img.onload = function() {
                let width = img.width;
                let height = img.height;

                if (width > maxWidth || height > maxHeight) {
                    const ratio = Math.min(maxWidth / width, maxHeight / height);
                    width = Math.floor(width * ratio);
                    height = Math.floor(height * ratio);
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob(
                    (blob) => {
                        if (blob) {
                            const thumbnailFile = new File([blob], `thumb_${file.name}`, { type: 'image/jpeg', lastModified: Date.now() });
                            resolve(thumbnailFile);
                        } else {
                            reject(new Error('Failed to generate thumbnail'));
                        }
                    },
                    'image/jpeg',
                    quality
                );
            };
            img.onerror = () => reject(new Error('Failed to load image for thumbnail'));
            img.src = e.target.result;
        };
        reader.onerror = () => reject(new Error('Failed to read file for thumbnail'));
        reader.readAsDataURL(file);
    });
}

// Photo Upload
export async function uploadLocationPhotos(locationId, files) {
    if (!supabaseInitialized) {
        console.log('Supabase Storage not initialized - photos cannot be uploaded');
        return [];
    }

    if (!files || files.length === 0) return [];

    const photoURLs = [];

    for (let i = 0; i < files.length; i++) {
        const file = files[i];

        if (!file.type.startsWith('image/')) continue;
        if (file.size > 10 * 1024 * 1024) {
            showNotification(`Photo ${file.name} is too large. Maximum size is 10MB.`, 'error');
            continue;
        }

        try {
            const compressedFile = await compressImage(file, 1200, 1200, 0.8);

            if (compressedFile.size > 2 * 1024 * 1024) {
                showNotification(`Photo ${file.name} is too large even after compression.`, 'error');
                continue;
            }

            const thumbnailFile = await generateThumbnail(file, 150, 150, 0.6);

            const timestamp = Date.now();
            const randomString = Math.random().toString(36).substring(7);
            const originalName = file.name.split('.')[0];
            const fullPath = `${locationId}/${timestamp}_${randomString}_${originalName}.jpg`;
            const thumbPath = `${locationId}/thumbs/${timestamp}_${randomString}_${originalName}_thumb.jpg`;

            const [fullUpload, thumbUpload] = await Promise.all([
                supabase.storage.from('location-photos').upload(fullPath, compressedFile, { contentType: 'image/jpeg' }),
                supabase.storage.from('location-photos').upload(thumbPath, thumbnailFile, { contentType: 'image/jpeg' })
            ]);

            if (fullUpload.error) throw fullUpload.error;
            if (thumbUpload.error) throw thumbUpload.error;

            const { data: fullUrlData } = supabase.storage.from('location-photos').getPublicUrl(fullPath);
            const { data: thumbUrlData } = supabase.storage.from('location-photos').getPublicUrl(thumbPath);

            photoURLs.push({
                full: fullUrlData.publicUrl,
                thumb: thumbUrlData.publicUrl
            });
        } catch (error) {
            console.error(`Error processing ${file.name}:`, error);
            showNotification(`Failed to process ${file.name}`, 'error');
        }
    }

    if (photoURLs.length > 0) {
        showNotification(`Uploaded ${photoURLs.length} optimized photo(s)`, 'success');
    }

    return photoURLs;
}

export function getStorageInstance() {
    return supabase ? supabase.storage : null;
}

export async function getAuthToken() {
    if (!supabase) return null;
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || null;
}

export async function authHeaders() {
    const token = await getAuthToken();
    if (!token) return { 'Content-Type': 'application/json' };
    return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
}

// Helper functions
function showLoading(message) {
    console.log('Loading:', message);
}

function hideLoading() {
    console.log('Loading complete');
}

function showNotification(message, type) {
    console.log(`${type.toUpperCase()}: ${message}`);
}
