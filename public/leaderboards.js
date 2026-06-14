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
    getLeaderboard,
    getReferralLeaderboard,
    updateUserNickname
} from './supabase-auth.js';

// DOM elements
const totalLocations = document.getElementById('totalLocations');
const totalReferrals = document.getElementById('totalReferrals');
const totalContributors = document.getElementById('totalContributors');
const locationsLeaderboardList = document.getElementById('locationsLeaderboardList');
const referralsLeaderboardList = document.getElementById('referralsLeaderboardList');

// Default avatar as data URI to avoid network requests
const DEFAULT_AVATAR = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMjAiIGZpbGw9IiM2NjdlZWEiLz4KPHBhdGggZD0iTTIwIDIyYzMuMzEzNyAwIDYtMi42ODYzIDYtNnMtMi42ODYzLTYtNi02cy02IDIuNjg2My02IDZTMTYuNjg2MyAyMiAyMCAyMnpNMjAgMjRjLTQuNjY2NyAwLTEzIDIuMzMzMy0xMyA3djNIMzN2LTNDMzMgMjYuMzMzMyAyNC42NjY3IDI0IDIwIDI0eiIgZmlsbD0id2hpdGUiLz4KPC9zdmc+';

// Helper function to get safe avatar URL with fallback
function getSafeAvatarUrl(photoURL) {
    if (!photoURL) return DEFAULT_AVATAR;
    
    // Handle Google Photos URL - ensure proper size parameter
    if (photoURL.includes('googleusercontent.com')) {
        // Remove existing size parameter and add our own
        return photoURL.replace(/=s\d+-c$/, '') + '=s64-c';
    }
    
    return photoURL;
}

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Leaderboards page loaded');
    
    // Initialize Firebase Authentication
    initializeAuth();
    
    // Setup event listeners
    setupEventListeners();
    setupAuthEventListeners();
    
    // Load leaderboards
    setTimeout(async () => {
        await loadAllLeaderboards();
    }, 1000); // Give auth time to initialize
});

// Load all leaderboards and stats
async function loadAllLeaderboards() {
    showLoading(true);
    
    try {
        console.log('🔄 Loading leaderboards...');
        
        // Load both leaderboards in parallel
        const [locationsLeaderboard, referralsLeaderboard] = await Promise.all([
            getLeaderboard(20),
            getReferralLeaderboard(20)
        ]);
        
        console.log('📊 Locations leaderboard:', locationsLeaderboard);
        console.log('🎁 Referrals leaderboard:', referralsLeaderboard);
        
        // Display leaderboards
        displayLocationsLeaderboard(locationsLeaderboard);
        displayReferralsLeaderboard(referralsLeaderboard);
        
        // Update stats
        updateCommunityStats(locationsLeaderboard, referralsLeaderboard);
        
    } catch (error) {
        console.error('❌ Error loading leaderboards:', error);
        showError('Failed to load leaderboards: ' + error.message);
    } finally {
        showLoading(false);
    }
}

// Display locations leaderboard
function displayLocationsLeaderboard(leaderboard) {
    if (!locationsLeaderboardList) {
        console.error('❌ locationsLeaderboardList element not found!');
        return;
    }

    if (!leaderboard || leaderboard.length === 0) {
        locationsLeaderboardList.innerHTML = `
            <div class="no-data">
                <p>🏆 No locations yet!</p>
                <p>Be the first to add a location and start the leaderboard.</p>
            </div>
        `;
        return;
    }

    const currentUser = getCurrentUser();
    const currentUserId = currentUser ? currentUser.uid : null;

    const html = leaderboard.map((user, index) => {
        const isCurrentUser = currentUserId === user.id;
        const rank = index + 1;
        let rankDisplay = `#${rank}`;
        let rankClass = '';
        
        if (rank === 1) {
            rankDisplay = '🥇';
            rankClass = 'gold';
        } else if (rank === 2) {
            rankDisplay = '🥈';
            rankClass = 'silver';
        } else if (rank === 3) {
            rankDisplay = '🥉';
            rankClass = 'bronze';
        }
        
        const safeAvatarUrl = getSafeAvatarUrl(user.photoURL);
        
        return `
            <div class="leaderboard-item ${isCurrentUser ? 'current-user' : ''}">
                <div class="rank ${rankClass}">${rankDisplay}</div>
                <img src="${safeAvatarUrl}" alt="${user.nickname} avatar" class="avatar" 
                     title="User: ${user.nickname}"
                     onerror="this.src='${DEFAULT_AVATAR}'; this.onerror=null;">
                <div class="user-info">
                    <div class="nickname">${user.nickname}</div>
                    <div class="locations-count">${user.locationsCreated} location${user.locationsCreated !== 1 ? 's' : ''}</div>
                </div>
                ${isCurrentUser ? '<div class="current-user-badge">You</div>' : ''}
            </div>
        `;
    }).join('');
    
    locationsLeaderboardList.innerHTML = html;
}

// Display referrals leaderboard
function displayReferralsLeaderboard(leaderboard) {
    if (!referralsLeaderboardList) return;

    if (leaderboard.length === 0) {
        referralsLeaderboardList.innerHTML = `
            <div class="no-data">
                <p>🎁 No referrals yet!</p>
                <p>Be the first to refer friends and earn recognition.</p>
            </div>
        `;
        return;
    }

    const currentUser = getCurrentUser();
    const currentUserId = currentUser ? currentUser.uid : null;

    referralsLeaderboardList.innerHTML = leaderboard.map((user, index) => {
        const isCurrentUser = currentUserId === user.id;
        const rank = index + 1;
        let rankDisplay = `#${rank}`;
        let rankClass = '';
        
        if (rank === 1) {
            rankDisplay = '🥇';
            rankClass = 'gold';
        } else if (rank === 2) {
            rankDisplay = '🥈';
            rankClass = 'silver';
        } else if (rank === 3) {
            rankDisplay = '🥉';
            rankClass = 'bronze';
        }
        
        const safeAvatarUrl = getSafeAvatarUrl(user.photoURL);
        
        return `
            <div class="leaderboard-item ${isCurrentUser ? 'current-user' : ''}">
                <div class="rank ${rankClass}">${rankDisplay}</div>
                <img src="${safeAvatarUrl}" alt="${user.nickname} avatar" class="avatar" 
                     title="User: ${user.nickname}"
                     onerror="this.src='${DEFAULT_AVATAR}'; this.onerror=null;">
                <div class="user-info">
                    <div class="nickname">${user.nickname}</div>
                    <div class="referrals-count">${user.referralCount} referral${user.referralCount !== 1 ? 's' : ''}</div>
                </div>
                ${isCurrentUser ? '<div class="current-user-badge">You</div>' : ''}
            </div>
        `;
    }).join('');
}

// Update community stats
function updateCommunityStats(locationsLeaderboard, referralsLeaderboard) {
    // Calculate total locations
    const totalLocationsCount = locationsLeaderboard.reduce((sum, user) => sum + (user.locationsCreated || 0), 0);
    if (totalLocations) {
        totalLocations.textContent = totalLocationsCount;
    }
    
    // Calculate total referrals
    const totalReferralsCount = referralsLeaderboard.reduce((sum, user) => sum + (user.referralCount || 0), 0);
    if (totalReferrals) {
        totalReferrals.textContent = totalReferralsCount;
    }
    
    // Count unique contributors (users who have created locations)
    const contributorsCount = locationsLeaderboard.length;
    if (totalContributors) {
        totalContributors.textContent = contributorsCount;
    }
}

// Setup basic event listeners
function setupEventListeners() {
    // Modal close buttons
    const modalCloses = document.querySelectorAll('.modal .close');
    modalCloses.forEach(closeBtn => {
        closeBtn.addEventListener('click', function() {
            this.closest('.modal').style.display = 'none';
        });
    });

    // Click outside modal to close
    window.addEventListener('click', function(event) {
        if (event.target.classList.contains('modal')) {
            event.target.style.display = 'none';
        }
    });
}

// Setup authentication event listeners
function setupAuthEventListeners() {
    // Auth button
    const authButton = document.getElementById('authButton');
    if (authButton) {
        authButton.addEventListener('click', function() {
            document.getElementById('authModal').style.display = 'block';
        });
    }

    // Google Sign In buttons
    const googleSignInBtn = document.getElementById('googleSignInBtn');
    const googleSignUpBtn = document.getElementById('googleSignUpBtn');
    
    if (googleSignInBtn) {
        googleSignInBtn.addEventListener('click', async () => {
            await signInWithGoogle();
        });
    }
    
    if (googleSignUpBtn) {
        googleSignUpBtn.addEventListener('click', async () => {
            await signInWithGoogle();
        });
    }

    // Email sign in form
    const emailSignInForm = document.getElementById('emailSignInForm');
    if (emailSignInForm) {
        emailSignInForm.addEventListener('submit', handleEmailSignIn);
    }

    // Email sign up form
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

// Handle email sign in
async function handleEmailSignIn(event) {
    event.preventDefault();
    
    const email = document.getElementById('signinEmail').value;
    const password = document.getElementById('signinPassword').value;
    
    const result = await signInWithEmail(email, password);
    if (result.success) {
        document.getElementById('authModal').style.display = 'none';
        // Reload leaderboards to highlight current user
        setTimeout(async () => {
            await loadAllLeaderboards();
        }, 1000);
    }
}

// Handle email sign up
async function handleEmailSignUp(event) {
    event.preventDefault();
    
    const nickname = document.getElementById('signupNickname').value;
    const email = document.getElementById('signupEmail').value;
    const password = document.getElementById('signupPassword').value;
    
    const result = await signUpWithEmail(email, password, nickname);
    if (result.success) {
        document.getElementById('authModal').style.display = 'none';
        // Reload leaderboards to highlight current user
        setTimeout(async () => {
            await loadAllLeaderboards();
        }, 1000);
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
            await updateUserNickname(user.uid, nickname);
            document.getElementById('nicknameModal').style.display = 'none';
            showNotification('Profile updated successfully!', 'success');
            // Reload leaderboards to show updated nickname
            setTimeout(async () => {
                await loadAllLeaderboards();
            }, 500);
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

// Show loading spinner
function showLoading(show) {
    const spinner = document.getElementById('loadingSpinner');
    if (spinner) {
        spinner.style.display = show ? 'flex' : 'none';
    }
}

// Show error message
function showError(message) {
    if (locationsLeaderboardList) {
        locationsLeaderboardList.innerHTML = `
            <div class="no-data">
                <p>❌ Error</p>
                <p>${message}</p>
            </div>
        `;
    }
    
    if (referralsLeaderboardList) {
        referralsLeaderboardList.innerHTML = `
            <div class="no-data">
                <p>❌ Error</p>
                <p>${message}</p>
            </div>
        `;
    }
}

// Show notification
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.textContent = message;
    
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
            if (document.body.contains(notification)) {
                document.body.removeChild(notification);
            }
        }, 300);
    }, 3000);
}
